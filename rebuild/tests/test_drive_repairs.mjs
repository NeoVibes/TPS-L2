import './test_setup.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {Matrix4,Quaternion,Vector3,Object3D} from 'three';
import {cassetteLift,applyArticulation} from '../viewer/eject-motion.mjs';
// The drive-train repairs of v0.2.10, on the full-detail export (packed frame: x across, y along the body, z = -depth).
const model=JSON.parse(fs.readFileSync('build/exports/model.json')),raw=gunzipSync(fs.readFileSync('build/exports/model.bin.gz')),part=Object.fromEntries(model.parts.map(p=>[p.id,p]));
const f32=r=>new Float32Array(raw.buffer,raw.byteOffset+r[0],r[1]),u32=r=>new Uint32Array(raw.buffer,raw.byteOffset+r[0],r[1]);
const pose=(p,name)=>{const [t,q,s]=p.poses[name];return new Matrix4().compose(new Vector3(...t),new Quaternion(...q),new Vector3(...s));};
// A part placed in pose a, or w of the way to pose b, as kitscene and the viewer place it (rig links, else a mix of poses).
function placement(p,a,b=a,w=0){
 if(p.links?.length){const M=new Matrix4();for(const L of p.links){const angle=L.poses[a][0]*(1-w)+L.poses[b][0]*w,t=new Vector3(...L.poses[a].slice(1)).lerp(new Vector3(...L.poses[b].slice(1)),w),piv=new Vector3(...L.pivot);M.multiply(new Matrix4().makeTranslation(t.x+piv.x,t.y+piv.y,t.z+piv.z).multiply(new Matrix4().makeRotationAxis(new Vector3(...L.axis).normalize(),angle)).multiply(new Matrix4().makeTranslation(-piv.x,-piv.y,-piv.z)));}return M.multiply(pose(p,'stop'));}
 const [ta,qa,sa]=p.poses[a],[tb,qb]=p.poses[b];return new Matrix4().compose(new Vector3(...ta).lerp(new Vector3(...tb),w),new Quaternion(...qa).slerp(new Quaternion(...qb),w),new Vector3(...sa));
}
function points(p,M,{travel=0,articulatedOnly=false}={}){const out=[];for(const m of p.meshes){if(articulatedOnly&&!m.articulation)continue;const o=new Object3D();if(m.articulation){applyArticulation(o,m.articulation,travel);o.updateMatrix();}const A=M.clone().multiply(o.matrix),v=f32(m.p);for(let i=0;i<v.length;i+=3)out.push(new Vector3(v[i],v[i+1],v[i+2]).applyMatrix4(A));}return out;}
function section(p,M,z0){const segs=[];for(const m of p.meshes){const v=f32(m.p),ix=u32(m.i),P=[];for(let i=0;i<v.length;i+=3)P.push(new Vector3(v[i],v[i+1],v[i+2]).applyMatrix4(M));for(let t=0;t<ix.length;t+=3){const q=[P[ix[t]],P[ix[t+1]],P[ix[t+2]]],cut=[];for(const [a,b] of [[0,1],[1,2],[2,0]]){const da=q[a].z-z0,db=q[b].z-z0;if((da<0)!==(db<0)){const u=da/(da-db);cut.push([q[a].x+u*(q[b].x-q[a].x),q[a].y+u*(q[b].y-q[a].y)]);}}if(cut.length===2)segs.push(cut);}}return segs;}
const toSegment=([px,py],[[ax,ay],[bx,by]])=>{const dx=bx-ax,dy=by-ay,L=dx*dx+dy*dy,u=L?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/L)):0;return Math.hypot(px-ax-u*dx,py-ay-u*dy);};
const report={passed:true,nativeSha256:model.source_sha256};

// 1. S gear A, the supply shaft, the reel table and the spindle turn as one, in every mode.
for(const mode of ['play','ff','rew']){
 const ref=part['BAY-031'],M0=pose(ref,mode),axis0=new Vector3(...ref.spin[mode].axis).transformDirection(M0),c0=new Vector3(...ref.spin[mode].center).applyMatrix4(M0);
 for(const id of ['DRV-100','DRV-010','BAY-021']){
  const p=part[id],s=p.spin?.[mode];assert(s,`${id} turns in ${mode}`);assert(Math.abs(s.rate-ref.spin[mode].rate)<=1e-9*ref.spin[mode].rate,`${id} turns at the spindle's rate in ${mode}`);
  const M=pose(p,mode),axis=new Vector3(...s.axis).transformDirection(M),d=new Vector3(...s.center).applyMatrix4(M).sub(c0);
  assert(axis.dot(axis0)>1-1e-9,`${id} turns the spindle's way in ${mode}`);assert(d.sub(axis0.clone().multiplyScalar(d.dot(axis0))).length()<.001,`${id} turns on the spindle's axis in ${mode}`);
 }
}
// 2. FR gear A's large tier clears S gear B's face in REW (0.2 mm designed).
{const A=part['DRV-012'],B=part['DRV-011'],MA=placement(A,'rew'),MB=placement(B,'rew');
 const axA=new Vector3(...A.spin.rew.axis).transformDirection(MA),cA=new Vector3(...A.spin.rew.center).applyMatrix4(MA),axB=new Vector3(...B.spin.rew.axis).transformDirection(MB),cB=new Vector3(...B.spin.rew.center).applyMatrix4(MB);
 assert(Math.abs(axA.dot(axB))>.9999,'the gears turn on parallel axes');
 const radial=v=>{const d=v.clone().sub(cA);return d.sub(axA.clone().multiplyScalar(d.dot(axA))).length();},h=v=>v.clone().sub(cB).dot(axB);
 const large=points(A,MA).filter(v=>radial(v)>2.7),reach=Math.max(...large.map(radial)),under=points(B,MB).filter(v=>radial(v)<=reach+.01),hA=large.map(h),hB=under.map(h);
 const above=hA.reduce((a,b)=>a+b)/hA.length>hB.reduce((a,b)=>a+b)/hB.length,gap=above?Math.min(...hA)-Math.max(...hB):Math.min(...hB)-Math.max(...hA);
 assert(gap>=.19,`FR gear A's large tier is ${gap} mm from S gear B's face in REW`);report.frGearAToSGearBFaceMm=gap;}
// 3. The head carriage's slot clears its guide pin all along the STOP-to-PLAY travel, in the plane of the carriage plate.
{const H=part['HDC-001'],P=part['HDC-031'],z0=1.3,pin=section(P,placement(P,'stop'),z0).flat();assert(pin.length>8,'the pin crosses the carriage plate plane');
 const c=[(Math.min(...pin.map(q=>q[0]))+Math.max(...pin.map(q=>q[0])))/2,(Math.min(...pin.map(q=>q[1]))+Math.max(...pin.map(q=>q[1])))/2],r=Math.max(...pin.map(q=>Math.hypot(q[0]-c[0],q[1]-c[1])));
 let nearest=Infinity;for(let k=0;k<=20;k++){const segs=section(H,placement(H,'stop','play',k/20),z0);for(const s of segs)nearest=Math.min(nearest,toSegment(c,s)-r);}
 assert(nearest>=.05,`the carriage slot comes within ${nearest} mm of its pin`);report.carriageSlotToPinMm=nearest;}
// 4. The EJECT tongue pushes the cassette: 0.05 mm behind its rear wall at rest, then touching it (within 0.05 mm, never
//    through it). Measured along z from the blade's leading corners to the cassette's surface straight in front of them.
{const L=part['STP-003'],C=part['MEDIA-002'],contact=L.ejectContact,ML=placement(L,'stop'),gaps=[];
 const lead=e=>{const b=points(L,ML,{travel:e,articulatedOnly:true}).filter(v=>v.y<42.9),z=Math.max(...b.map(v=>v.z));return b.filter(v=>v.z>z-1e-3);};
 const surface=(e,[x,y])=>{const [t,q,s]=C.poses.open,M=new Matrix4().compose(new Vector3(t[0],t[1],t[2]+cassetteLift(contact,e)),new Quaternion(...q),new Vector3(...s));let best=Infinity;
  for(const m of C.meshes){const v=f32(m.p),ix=u32(m.i),P=i=>new Vector3(v[3*i],v[3*i+1],v[3*i+2]).applyMatrix4(M);for(let k=0;k<ix.length;k+=3){const [A,B,D]=[P(ix[k]),P(ix[k+1]),P(ix[k+2])],det=(B.x-A.x)*(D.y-A.y)-(D.x-A.x)*(B.y-A.y);if(Math.abs(det)<1e-12)continue;
   const u=((x-A.x)*(D.y-A.y)-(D.x-A.x)*(y-A.y))/det,w=((B.x-A.x)*(y-A.y)-(x-A.x)*(B.y-A.y))/det;if(u<-1e-9||w<-1e-9||u+w>1+1e-9)continue;best=Math.min(best,A.z+u*(B.z-A.z)+w*(D.z-A.z));}}return best;};
 for(let k=0;k<=40;k++){const e=k/40,g=lead(e).map(v=>surface(e,[v.x,v.y])-v.z).filter(Number.isFinite);assert(g.length,`the cassette lies in front of the EJECT tongue at travel ${e}`);
  const gap=Math.min(...g);gaps.push(gap);assert(gap>=-1e-4,`the EJECT tongue is ${-gap} mm into the cassette at travel ${e}`);if(e>=.05)assert(gap<=.05,`the EJECT tongue is ${gap} mm off the cassette at travel ${e}`);}
 assert(Math.abs(gaps[0]-.05)<.005,`the EJECT tongue rests ${gaps[0]} mm behind the cassette`);report.ejectTongueGapMm={atRest:gaps[0],whilePushingMax:Math.max(...gaps.slice(2)),lowest:Math.min(...gaps)};report.cassetteLiftMm=cassetteLift(contact,1);}

// 5. The bay ends leave room for the cassette while preserving the measured outside of the top rail. The EJECT
//    fold remains on the cassette side of the rail's face throughout its stroke; the rivet clears it in depth.
{const extent=id=>{const P=points(part[id],placement(part[id],'stop'));return {lo:['x','y','z'].map(a=>Math.min(...P.map(v=>v[a]))),hi:['x','y','z'].map(a=>Math.max(...P.map(v=>v[a])))};};
 const R=extent('BAY-073'),B=extent('BAY-071'),C=extent('MEDIA-001'),D=extent('MEDIA-002'),rivet=extent('STP-004');
 const top=R.lo[1]-Math.max(C.hi[1],D.hi[1]),battery=Math.min(C.lo[1],D.lo[1])-B.hi[1],rivetGap=R.lo[2]-rivet.hi[2];
 assert(Math.abs(top-1.65)<.005,`top rail is ${top} mm beyond the cassette`);
 assert(Math.abs(battery-1)<.005,`battery-end block is ${battery} mm beyond the cassette`);
 assert(Math.abs(R.hi[1]-48.95)<.005&&Math.abs(R.hi[2]-13.4)<.005,'the rail retains its measured outside edge and top');
 assert(Math.abs(B.hi[2]-R.hi[2])<.005,'the solid battery-end block reaches the rail level');
 assert(rivetGap>=.1,`the EJECT rivet clears the rail in depth by ${rivetGap} mm`);
 for(let n=0;n<=40;n++){const P=points(part['STP-003'],placement(part['STP-003'],'stop'),{travel:n/40});assert(Math.max(...P.map(v=>v.y))<=R.lo[1]+.001,`EJECT fold crosses the rail face at travel ${n/40}`);}
 const lid=points(part['EXT-030'],placement(part['EXT-030'],'stop')),topFlap=lid.filter(v=>v.y>45.25&&v.y<46.05);
 assert(topFlap.length,'top lid flap exists');const topGap=Math.min(...topFlap.map(v=>v.z))-R.hi[2];assert(Math.abs(topGap-.02)<.005,`top lid flap ends ${topGap} mm above the rail level`);
 // A clearance-only check accepted the missing bottom section. Check actual closure across the flat bottom width:
 // cast through the bottom wall at eight positions and measure the seam between the lid and cabinet return.
 const depthsAt=(p,x,y)=>{const M=placement(p,'stop'),hits=[];for(const m of p.meshes){const v=f32(m.p),ix=u32(m.i),P=i=>new Vector3(v[3*i],v[3*i+1],v[3*i+2]).applyMatrix4(M);
  for(let i=0;i<ix.length;i+=3){const A=P(ix[i]),B=P(ix[i+1]),C=P(ix[i+2]),det=(B.x-A.x)*(C.y-A.y)-(C.x-A.x)*(B.y-A.y);if(Math.abs(det)<1e-12)continue;
   const u=((x-A.x)*(C.y-A.y)-(C.x-A.x)*(y-A.y))/det,w=((B.x-A.x)*(y-A.y)-(x-A.x)*(B.y-A.y))/det;
   if(u>=-1e-8&&w>=-1e-8&&u+w<=1+1e-8)hits.push(A.z+u*(B.z-A.z)+w*(C.z-A.z));}}return hits;};
 const bottomSeams=[];
 for(const x of [-39,-30,-20,-10,0,10,20,25]){const L=depthsAt(part['EXT-030'],x,-66.375),H=depthsAt(part['EXT-010'],x,-66.375);
  assert(L.length&&H.length,`bottom closure has lid and cabinet material at x=${x}`);const gap=Math.min(...L)-Math.max(...H);
  // Same section on the original rounded edge: 0.3205315 mm at every station (tip gap about 0.216 mm).
  assert(Math.abs(gap-.3205315)<.005,`bottom seam at x=${x} has a ${gap} mm opening; original is 0.3205315 mm`);bottomSeams.push({x,gap});}
 report.bayEndsMm={cassetteToTopRail:top,cassetteToBatteryBlock:battery,rivetToRail:rivetGap,topFlapAboveRail:topGap,bottomSeams};}

report.scope='S gear A, shaft, reel table and spindle turn as one; FR gear A clears S gear B axially in REW; carriage slot section clears the guide pin over the STOP-PLAY travel; EJECT tongue pushes the native cassette within 0.05 mm without crossing; bay end gaps, rail outside dimensions, rivet clearance, fold plane and closed flap rest. Vertex and section measures on the native export; exact mesh clearance and both cassette models are checked in the geometry tools.';
fs.writeFileSync('build/test-results/drive-repairs-tests.json',JSON.stringify(report,null,2)+'\n');console.log('DRIVE REPAIRS PASS',JSON.stringify(report.ejectTongueGapMm),report.frGearAToSGearBFaceMm.toFixed(4),report.carriageSlotToPinMm.toFixed(4));
