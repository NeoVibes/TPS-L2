// Each wire's metal touches only what tests/reference/wire-contacts.json lists for it (its own lands and joints), at
// rest and in PLAY: a wire meeting a lead, fillet or trace on its way, as the TONE links once did, adds a contact.
// Each IC, transistor and servo-board fillet holds the lead through it; each volume terminal meets the AF solder.
// Full export and packed viewer geometry alike.
import './test_setup.mjs';
import assert from 'node:assert/strict';
import {Vector3 as V,Quaternion,Matrix4,Box3} from 'three';
import {json,eps,overlaps,pair,openModel} from './wiring_geometry.mjs';
for(const packed of [false,true]){
 const {tag,model,raw,parts,get,isMetal}=openModel(packed);
 // Each wire's metal touches only what tests/reference/wire-contacts.json lists for it (its own lands and joints), at
 // rest and in PLAY. A wire meeting a lead, fillet or trace on its way, as the TONE links once did, adds a contact here.
 const metalOf=(id,pose)=>parts.get(id).meshes.some(isMetal)?get(id,'','',pose,null,null,true):null;
 const local=new Map();   // each chunk's own bounds, read straight from its positions
 function chunkBox(id,k,pose){
  const p=parts.get(id),c=p.meshes[k];let b=local.get(id+'#'+k);
  if(!b){const pos=packed?new Uint16Array(raw.buffer,raw.byteOffset+c.p[0],c.p[1]):new Float32Array(raw.buffer,raw.byteOffset+c.p[0],c.p[1]);
   const lo=[1/0,1/0,1/0],hi=[-1/0,-1/0,-1/0];
   for(let j=0;j<pos.length;j+=3)for(let d=0;d<3;d++){const v=packed?pos[j+d]*c.pscale[d]+c.pmin[d]:pos[j+d];if(v<lo[d])lo[d]=v;if(v>hi[d])hi[d]=v;}
   b=[lo,hi];local.set(id+'#'+k,b);}
  const [t,q,sc]=p.poses[pose],m=new Matrix4().compose(new V(...t),new Quaternion(...q),new V(...sc)),box=new Box3();
  for(const x of [b[0][0],b[1][0]])for(const y of [b[0][1],b[1][1]])for(const z of [b[0][2],b[1][2]])box.expandByPoint(new V(x,y,z).applyMatrix4(m));
  return box.expandByScalar(.5);   // room for shape keys
 }
 const contacts={},EVERYWHERE=new Box3(new V(-1e9,-1e9,-1e9),new V(1e9,1e9,1e9));
 for(const pose of ['stop','play'])for(const w of [...parts.keys()].filter(id=>id.startsWith('WIR-'))){
  const wt=get(w,'','',pose,null,EVERYWHERE,true),box=wt.box.clone().expandByScalar(eps);   // a clip: not kept in the cache
  for(const [id,p] of parts){if(id===w)continue;
   p.meshes.forEach((c,k)=>{if(!isMetal(c)||!overlaps(box,chunkBox(id,k,pose)))return;
    const land=c.wireLand||null,mat=land?'':model.materials[c.m].name;   // null: untagged chunks only
    if(pair(wt,get(id,land,mat,pose,null,box,true)))(contacts[w]??=new Set()).add(id+' / '+(land||mat));});}
 }
 const expected=json('tests/reference/wire-contacts.json');
 for(const w of new Set([...Object.keys(expected),...Object.keys(contacts)])){
  const found=[...(contacts[w]??[])].sort();assert.deepEqual(found,expected[w]??[],tag+' '+w+' touches '+JSON.stringify(found));
 }
 // Through-hole joints: each IC, transistor and servo-board fillet holds the lead through it; each volume terminal meets
 // the AF board's solder.
 const leadParts=[...parts.keys()].filter(id=>/^(RES|CAP|TR|DIO|IC|THP|SVR)-\d|^MB-[1-9]\d\d$/.test(id));
 const holes=['MB-001','SB-001'].flatMap(b=>parts.get(b).meshes.filter(c=>/^New main solder (IC|Q)\d+ pin\d$|^Servo PCB solder /.test(c.wireLand||'')&&/solder (estimate|fillets)/.test(model.materials[c.m].name)).map(c=>[b,c.wireLand]));
 assert.equal(new Set(holes.map(h=>h[1])).size,99,tag+' through-hole joints');
 for(const [b,land] of holes){const h=get(b,land),box=h.box.clone().expandByScalar(eps);
  assert(leadParts.some(id=>{const t=metalOf(id,'stop');return t&&overlaps(box,t.box)&&pair(h,get(id,'','','stop',null,box,true));}),tag+' '+land+' holds no lead');}
 for(const k of [16,17,18,26,27,28])assert(pair(get('VOL-0'+k,'','','stop',null,null,true),get('VOL-001','','solder')),tag+' VOL-0'+k+' meets its solder');
 console.log(tag+': '+Object.keys(contacts).length+' wires touch only their lands; '+holes.length+' through-hole joints and six volume terminals hold.');
}
