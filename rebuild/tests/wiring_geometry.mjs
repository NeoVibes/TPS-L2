// Shared by the wiring tests: the exported model's triangles by part, land and material, and a triangle-contact test
// (separating axes, within eps, or a margin given: negative, how deep they may overlap). openModel(packed) reads the full export or the packed viewer geometry.
import assert from 'node:assert/strict';
import {readFileSync as read} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {Vector3 as V,Quaternion,Matrix4,Box3} from 'three';
export const json=p=>JSON.parse(read(p));
export const eps=.002; // millimetres; below the smallest deliberate switch gap
export const overlaps=(a,b)=>a.min.x<=b.max.x+eps&&b.min.x<=a.max.x+eps&&a.min.y<=b.max.y+eps&&b.min.y<=a.max.y+eps&&a.min.z<=b.max.z+eps&&b.min.z<=a.max.z+eps;
export function tri(pts){
 const e=pts.map((p,i)=>pts[(i+1)%3].clone().sub(p)),n=e[0].clone().cross(e[1]);
 return {pts,e,n,box:new Box3().setFromPoints(pts)};
}
export function touching(a,b,e=eps){
 if(!(a.box.min.x<=b.box.max.x+e&&b.box.min.x<=a.box.max.x+e&&a.box.min.y<=b.box.max.y+e&&b.box.min.y<=a.box.max.y+e&&a.box.min.z<=b.box.max.z+e&&b.box.min.z<=a.box.max.z+e))return false;
 // Triangle SAT, including in-plane, edge-normal axes for coplanar triangles.
 const separated=axis=>{const l=axis.length();if(l<1e-11)return false;
  const A=a.pts.map(p=>p.dot(axis)),B=b.pts.map(p=>p.dot(axis));
  return Math.min(...A)>Math.max(...B)+e*l||Math.min(...B)>Math.max(...A)+e*l;};
 if(separated(a.n)||separated(b.n))return false;
 for(const e of a.e){if(separated(e.clone().cross(a.n)))return false;for(const f of b.e)if(separated(e.clone().cross(f)))return false;}
 for(const f of b.e)if(separated(f.clone().cross(b.n)))return false;
 return true;
}
export function tree(ts){
 const box=ts.reduce((b,t)=>b.union(t.box),new Box3());
 if(ts.length<20)return {box,ts};
 const size=box.getSize(new V()),k=size.x>=size.y&&size.x>=size.z?'x':size.y>=size.z?'y':'z';
 ts.sort((a,b)=>a.box.min[k]+a.box.max[k]-b.box.min[k]-b.box.max[k]);
 const m=ts.length>>1;return {box,l:tree(ts.slice(0,m)),r:tree(ts.slice(m))};
}
export function pair(a,b,e=eps){if(!(a.box.min.x<=b.box.max.x+e&&b.box.min.x<=a.box.max.x+e&&a.box.min.y<=b.box.max.y+e&&b.box.min.y<=a.box.max.y+e&&a.box.min.z<=b.box.max.z+e&&b.box.min.z<=a.box.max.z+e))return false;
 if(!a.ts)return pair(a.l,b,e)||pair(a.r,b,e);
 if(!b.ts)return pair(a,b.l,e)||pair(a,b.r,e);
 return a.ts.some(x=>b.ts.some(y=>touching(x,y,e)));
}
export function openModel(packed){
 const tag=packed?'model-packed':'model',model=json('build/exports/'+tag+'.json'),raw=gunzipSync(read('build/exports/'+tag+'.bin.gz'));
 const parts=new Map(model.parts.map(p=>[p.id,p]));const cache=new Map();
 // Metal, by material name (the wire screen's rule): what can carry current.
 const METAL=/tin|solder|copper|brass|plated|plating|phosphor|steel|metal|bronze|zinc|eyelet|terminal|contact|\blead|conductor/i,INSULATING=/insulation|insulating|insulator|mask|paper|coating/i;
 const isMetal=c=>{const n=model.materials[c.m].name;return METAL.test(n)&&!INSULATING.test(n);};
 function get(id,land='',material='',pose='stop',switchPosition=null,clip=null,metalOnly=false){
  const key=JSON.stringify(arguments);if(cache.has(key))return cache.get(key);
  const p=parts.get(id);assert(p,id);const [t,q,s]=p.poses[pose];
  const point=new V(...t);if(switchPosition!==null){const tone=typeof switchPosition==='string';const value=tone?Number(switchPosition):switchPosition;const track=model.controls[tone?'tone':'hotline'].parts[id];if(track)point.add(new V(...track.samples.find(s=>s.value===value).position).sub(new V(...track.restPosition)));}
  const m=new Matrix4().compose(point,new Quaternion(...q),new V(...s)),tris=[];
  for(const chunk of p.meshes){if((land===null?chunk.wireLand:land&&chunk.wireLand!==land)||!model.materials[chunk.m].name.toLowerCase().includes(material.toLowerCase())||metalOnly&&!isMetal(chunk))continue;
   const pos=packed?new Uint16Array(raw.buffer,raw.byteOffset+chunk.p[0],chunk.p[1]):new Float32Array(raw.buffer,raw.byteOffset+chunk.p[0],chunk.p[1]);
   const I=packed&&chunk.indexType==='u16'?Uint16Array:Uint32Array;
   const ids=new I(raw.buffer,raw.byteOffset+chunk.i[0],chunk.i[1]);
   const ps=[];for(let j=0;j<pos.length;j+=3){const xyz=[0,1,2].map(d=>{
    let v=packed?pos[j+d]*chunk.pscale[d]+chunk.pmin[d]:pos[j+d];
    for(const target of chunk.deformation?.targets||[])v+=target.positions[j+d]*(target.weights[pose]-target.initial);
    return v;});ps.push(new V(...xyz).applyMatrix4(m));}
   for(let j=0;j<ids.length;j+=3){
    const points=[ps[ids[j]],ps[ids[j+1]],ps[ids[j+2]]];
    if(!clip||overlaps(clip,new Box3().setFromPoints(points)))tris.push(tri(points));
   }
  }
  assert(clip||tris.length,'No conductive surface: '+[id,land,material]);const result=tree(tris);if(!clip)cache.set(key,result);return result;
 }
 return {tag,model,raw,parts,get,isMetal};
}
