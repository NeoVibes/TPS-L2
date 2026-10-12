import './test_setup.mjs';
import {pageHtml,modelFile,geometryBytes,geometryBuffer,viewFiles,buildRecord,fakeDocument} from './kit_files.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import * as T from 'three';
import {beltTravel,advancePartAngle,stripeCoverage,wrapDistance} from '../viewer/drive-motion.mjs';
import {makeDriveMaterial} from '../viewer/drive-materials.mjs';
import {assertInventoryCoverage} from './inventory_contract.mjs';
import {countGeometry} from './geometry_contract.mjs';
import {tourMotion} from '../viewer/tour-timeline.mjs';

const read=p=>JSON.parse(fs.readFileSync(p)),hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const model=read('build/exports/model.json'),packed=read('build/exports/model-packed.json'),viewer=read('build/viewer-data/model.json');
assertInventoryCoverage(model);
const bytes=gunzipSync(fs.readFileSync('build/exports/model.bin.gz'));
const packedBytes=gunzipSync(fs.readFileSync('build/exports/model-packed.bin.gz'));
const array=(b,range,C=Float32Array)=>new C(b.buffer,b.byteOffset+range[0],range[1]);
const close=(a,b,t,label)=>assert.ok(Math.abs(a-b)<=t,`${label}: ${a} / ${b}`);
let triangles=0,scalars=0,seamTriangles=0,coordinateComparisons=0,phaseChecks=0;
const frozen=countGeometry(model,bytes);triangles=frozen.triangles;scalars=frozen.scalars;
for(const p of model.parts){
 if(!p.belt)continue;
 const b=p.belt,pp=packed.parts.find(q=>q.id===p.id),vp=viewer.parts.find(q=>q.id===p.id);
 assert.deepEqual(pp.belt,b);assert.deepEqual(vp.belt,b);
 const pkg=geometryBuffer(vp.package);
 assert.ok(b.loopLengthMm>120&&b.loopLengthMm<165);
 assert.ok(Object.values(b.modeledMismatchMmS).every(v=>v<.002));
 assert.equal(p.spin&&Object.keys(p.spin).length,0,'Belt path must stay rigid; only its surface cue travels');
 for(let c=0;c<p.meshes.length;c++) {
  const mesh=p.meshes[c],distance=array(bytes,mesh.beltS),packedDistance=array(packedBytes,pp.meshes[c].beltS),loadedDistance=array(pkg,vp.meshes[c].beltS);
  assert.equal(distance.length,mesh.p[1]/3);
  assert.equal(Math.min(...distance),0);close(Math.max(...distance),b.loopLengthMm,.00002,'Seam L');
  assert.equal(new Set(distance).size,b.rings+1,'Exactly one distance per native ring plus export seam');
  for(let i=0;i<distance.length;i++){assert.equal(distance[i],packedDistance[i]);assert.equal(distance[i],loadedDistance[i]);coordinateComparisons++;}
  const inds=array(bytes,mesh.i,Uint32Array),positions=array(bytes,mesh.p),zero=new Set(),end=new Set();
  for(let i=0;i<distance.length;i++) {
   const key=[...positions.subarray(i*3,i*3+3)].join(',');
   if(distance[i]===0)zero.add(key);
   if(Math.abs(distance[i]-b.loopLengthMm)<.00002)end.add(key);
  }
  assert.deepEqual(end,zero,'Export seam copies have exactly the same native positions');
  for(let i=0;i<inds.length;i+=3) {
   const s=[distance[inds[i]],distance[inds[i+1]],distance[inds[i+2]]];
   assert.ok(Math.max(...s)-Math.min(...s)<.255,'Triangle interpolates backwards across the loop seam');
   if(Math.max(...s)>b.loopLengthMm-.00002){seamTriangles++;assert.ok(Math.min(...s)>b.loopLengthMm-.255);}
  }
 }
 // Independent periodic run counting, including a mark straddling the seam.
 for(const phase of [0,.0001,b.loopLengthMm/3,b.loopLengthMm-.2,3*b.loopLengthMm]) {
  const n=32768,mask=Array.from({length:n},(_,i)=>stripeCoverage(i*b.loopLengthMm/n,phase,b.loopLengthMm,b.stripeWidthMm)>.5);
  assert.equal(mask.filter((v,i)=>v&&!mask[(i+n-1)%n]).length,1,'One complete stripe per loop');
  close(mask.filter(Boolean).length/n*b.loopLengthMm,b.stripeWidthMm,.012,'White stripe width');
  close(stripeCoverage(0,phase,b.loopLengthMm,b.stripeWidthMm),stripeCoverage(b.loopLengthMm,phase,b.loopLengthMm,b.stripeWidthMm),1e-9,'Seam appearance');
 }
 const driver=model.parts.find(q=>q.id===b.driverId),reference=new T.Vector3().fromArray(driver.spin.play.axis);
 const spin=mode=>{const r=driver.spin[mode];return r?{rate:r.rate*reference.dot(new T.Vector3().fromArray(r.axis))}:null;};
 let angle=0,oracle=0;
 const state={mode:'play',view:'assembled',media:'loaded',door:false,paused:false,explode:0,radial:0,speed:1};
 for(const event of [
  {dt:.1},{dt:1.5,speed:.05},{dt:.27,mode:'ff',speed:1},{dt:.4,mode:'rew'},
  {dt:2,paused:true},{dt:.2,paused:false,view:'service'},{dt:3,view:'exploded',radial:1},
  {dt:3,view:'catalog',radial:0,explode:1},{dt:.4,view:'assembled',explode:0,displayExplosion:.3},{dt:.31,displayExplosion:0},
  {dt:1,door:true},{dt:.2,door:false},{dt:0}, // resume after background: no hidden elapsed time
 ]) {
  Object.assign(state,event);
  const enabled=!state.paused&&!['exploded','catalog'].includes(state.view)&&!(state.displayExplosion>0)&&!(state.displayRadial>0);
  if(enabled)oracle+=spin(state.mode).rate*event.dt*state.speed;
  angle=advancePartAngle(angle,driver,spin(state.mode),state,event.dt);
  close(angle,oracle,1e-10,'Pulley accumulation');
  // Contact speed from an independently sampled native angular delta.
  const native=b.contacts.find(c=>c.owner===b.driverId);
  const speedPerPositiveAngle=native.signed_speed_mm_s.play/driver.spin.play.rate;
  const expected=wrapDistance(oracle*speedPerPositiveAngle,b.loopLengthMm);
  close(beltTravel(b,angle),expected,.002,'Travel follows native signed contact velocity');phaseChecks++;
 }
 assert.equal(beltTravel(b,0),0,'Reset clears belt travel with pulley angle');
 close(spin('play').rate,spin('ff').rate,1e-8,'FF does not multiply motor speed');
 const seekSteps=[{duration:5,mode:'play',view:'service'},{duration:3,mode:'ff',view:'service'},{duration:2,mode:'rew',view:'assembled'},{duration:4,mode:'play',view:'catalog'}];
 for(const time of [0,1,7,9,14,3,0]) {
  const seconds=tourMotion(time,seekSteps).modeSeconds;
  const a=Object.entries(seconds).reduce((sum,[mode,dt])=>sum+(spin(mode)?.rate||0)*dt,0);
  const independent=spin('play').rate*Math.min(time,5)+spin('ff').rate*Math.max(0,Math.min(time-5,3))+spin('rew').rate*Math.max(0,Math.min(time-8,2));
  close(beltTravel(b,a),beltTravel(b,independent),1e-8,'Seek and separated chapters');phaseChecks++;
 }
 for(const c of b.contacts) {
  const wheel=model.parts.find(q=>q.id===c.owner);
  assert.equal(wheel.rest_when_separated,false);assert.deepEqual(wheel.service,[0,0,0],'Service must keep the entire audited drive assembled');
 }
}
assert.equal(seamTriangles,64);
const masks=[];
for(const p of model.parts.filter(p=>p.belt||p.motorWitness)) {
 const base=new T.MeshStandardMaterial({color:0x665544});
 const uniform={value:0},enabled={value:1};
 const material=makeDriveMaterial(base,p,{travel:uniform,enabled});
 const shader={uniforms:{},vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader);
 assert.ok(shader.fragmentShader.includes('cueMask'));
 assert.strictEqual(shader.uniforms.cueEnabled,enabled);
 assert.ok(shader.fragmentShader.includes('fwidth'));
 if(p.belt){assert.strictEqual(shader.uniforms.beltTravel,uniform);assert.ok(shader.vertexShader.includes('attribute float beltS'));assert.equal(material.roughness,.88);}
 else {
  assert.ok(!Object.hasOwn(shader.uniforms,'beltTravel'),'Motor masks have no independent time/phase uniform');
  assert.ok(shader.vertexShader.includes('vCuePosition=position'));
  const w=p.motorWitness;assert.ok(w.axis[1]<-.99,'Witness must face the exposed drive end, away from the motor housing');const axis=new T.Vector3().fromArray(w.axis),u=new T.Vector3(1,0,0).addScaledVector(axis,-axis.x).normalize();
  const point=new T.Vector3().fromArray(w.center).addScaledVector(axis,w.endProjection).addScaledVector(u,w.radiusMm*(w.kind==='shaft'?.48:.65));
  const ray=new T.Raycaster(point.clone().addScaledVector(axis,1),axis.clone().negate());
  let found=false;
  for(const mesh of p.meshes){const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(array(bytes,mesh.p),3));g.setIndex(new T.BufferAttribute(array(bytes,mesh.i,Uint32Array),1));const m=new T.Mesh(g,new T.MeshBasicMaterial({side:T.DoubleSide}));m.updateMatrixWorld();const hits=ray.intersectObject(m);if(hits.length&&hits[0].point.distanceTo(point)<.02)found=true;}
  assert.ok(found,`${p.id} witness location must intersect its exposed end face`);
  if(w.kind==='pulley') {
   assert.ok(Number.isFinite(w.backProjection)&&w.backProjection<w.endProjection);
   assert.equal(packed.parts.find(q=>q.id===p.id).motorWitness.backProjection,w.backProjection);
   assert.equal(viewer.parts.find(q=>q.id===p.id).motorWitness.backProjection,w.backProjection);
   const backPoint=new T.Vector3().fromArray(w.center).addScaledVector(axis,w.backProjection).addScaledVector(u,w.radiusMm*.72);
   const backRay=new T.Raycaster(backPoint.clone().addScaledVector(axis,-1),axis);
   let backFound=false;
   for(const mesh of p.meshes){const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(array(bytes,mesh.p),3));g.setIndex(new T.BufferAttribute(array(bytes,mesh.i,Uint32Array),1));const m=new T.Mesh(g,new T.MeshBasicMaterial({side:T.DoubleSide}));m.updateMatrixWorld();const hits=backRay.intersectObject(m);if(hits.length&&hits[0].point.distanceTo(backPoint)<.02)backFound=true;}
   assert.ok(backFound,'Lower pulley dot must intersect the opposite end face');
   assert.equal(shader.uniforms.cueBack.value,w.backProjection);
   const rimPoint=new T.Vector3().fromArray(w.center).addScaledVector(axis,w.endProjection-.375).addScaledVector(u,w.radiusMm);
   const rimRay=new T.Raycaster(rimPoint.clone().addScaledVector(u,1),u.clone().negate());
   let rimFound=false;
   for(const mesh of p.meshes){const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(array(bytes,mesh.p),3));g.setIndex(new T.BufferAttribute(array(bytes,mesh.i,Uint32Array),1));const m=new T.Mesh(g,new T.MeshBasicMaterial({side:T.DoubleSide}));m.updateMatrixWorld();const hits=rimRay.intersectObject(m);if(hits.length&&hits[0].point.distanceTo(rimPoint)<.02)rimFound=true;}
   assert.ok(rimFound,'Small lower-rim dot must intersect the actual flange');
  }
  const turned=point.clone().sub(new T.Vector3().fromArray(w.center)).applyAxisAngle(axis,.6).add(new T.Vector3().fromArray(w.center));
  assert.ok(turned.distanceTo(point)>.05,'Off-axis mark must visibly move with the owner transform');masks.push(p.id);
 }
}
const context=viewer.inspectionContexts.motorCutaway;
for(const id of ['MTR-001','MTR-002','MTR-003','MTR-010','MTR-013','MTR-030','MTR-040','MTR-041'])assert.ok(!context.partIds.includes(id),'Opaque motor cover must be hidden in the cutaway');
for(const id of ['MTR-004','MTR-005','MTR-020','MTR-025','MTR-011','MTR-031','MTR-033'])assert.ok(context.partIds.includes(id),'Cutaway retains moving and stationary inspection references');
for(const pid of ['MTR-001','MTR-002','MTR-003','MTR-010','MTR-011','MTR-012','MTR-013','MTR-030','MTR-031','MTR-032','MTR-033','MTR-034','MTR-040','MTR-041','MTR-042'])if(context.partIds.includes(pid))assert.deepEqual(model.parts.find(p=>p.id===pid).spin,{},'Fixed motor part exported as rotating');
assert.equal(model.parts.filter(p=>p.belt).length,2);
const report={passed:true,nativeSha256:model.source_sha256,metadataSha256:hash('build/exports/model.json'),packedMetadataSha256:hash('build/exports/model-packed.json'),buildReportSha256:buildRecord().sha256,trianglesPreserved:triangles,positionNormalScalarsCompared:scalars,seamTriangles,coordinateRoundTripComparisons:coordinateComparisons,phaseChecks,motorWitnessFaces:masks,sourceHashes:Object.fromEntries(['viewer/drive-motion.mjs','viewer/drive-materials.mjs','tools/belt_geometry.py','tests/test_drive_motion.mjs'].map(p=>[p,hash(p)])),browserVisualAcceptance:false,scope:'Native/current-mesh and exported geometry, signed velocities, full seam, one stripe, packing/loading, material masks, state/phase and cutaway contracts. This is not a WebGL rendering or perceptual motion-visibility test.'};
fs.writeFileSync('build/test-results/drive-motion-tests.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
