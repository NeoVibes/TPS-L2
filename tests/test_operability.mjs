import './test_setup.mjs';
import {pageHtml,modelFile,geometryBytes,geometryBuffer,viewFiles,buildRecord,fakeDocument} from './kit_files.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import * as T from 'three';
import {assertInventoryCoverage} from './inventory_contract.mjs';
import {createOperatingState,dispatchOperating,advanceOperating,isTapeMoving} from '../viewer/operating-state.mjs';
import {operatingPose,modelControlsEnabled,batterySequence} from '../viewer/operating-pose.mjs';
import {advancePartAngle,beltTravel,stripeCoverage} from '../viewer/drive-motion.mjs';
import {createDoorMotion,applyHingePose} from '../viewer/door-motion.mjs';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const model=read('build/exports/model.json'),packed=read('build/exports/model-packed.json'),viewer=read('build/viewer-data/model.json');
const native=read('build/exports/native-checks.json');assert(native.native_unchanged);assert.equal(native.native_sha256,model.source_sha256);
assert.equal(model.nativeCueSubstitutions.length,6);assertInventoryCoverage(model);
const byId=Object.fromEntries(model.parts.map(p=>[p.id,p]));let operatingCases=0,seamTriangles=0,packedDistances=0;
for(const mode of ['play','ff','rew'])for(const door of [false,true])for(const media of ['loaded','ejected','removed']){
 const state=createOperatingState({mode,door,media,tapePosition:.5,speed:1,view:'assembled',explode:0,radial:0,uiMode:'operate'});
 assert.equal(state.mode,mode);const before=state.tapePosition;advanceOperating(state,.25);
 assert.equal(state.tapePosition!==before,media==='loaded');
 for(const p of model.parts)assert.ok(p.poses[operatingPose(state)],`${p.id}/${operatingPose(state)}`);
 const motor=byId['MTR-005'];assert.notEqual(advancePartAngle(0,motor,motor.spin[mode],state,.1),0);
 const reel=byId['MEDIA-003'];assert.equal(advancePartAngle(0,reel,reel.spin[mode],state,.1)!==0,media==='loaded');
 dispatchOperating(state,{type:'door'});assert.equal(state.mode,mode);
 state.view='service';assert.equal(modelControlsEnabled(state),true);assert.equal(isTapeMoving(state),false);
 assert.notEqual(advancePartAngle(0,motor,motor.spin[mode],state,.1),0);
 assert.equal(advancePartAngle(0,reel,reel.spin[mode],state,.1),0);
 state.view='exploded';state.radial=1;assert.equal(operatingPose(state),'stop');assert.equal(modelControlsEnabled(state),false);assert.equal(advancePartAngle(1,motor,motor.spin[mode],state,.1),1);
 state.view='assembled';state.radial=0;assert.equal(modelControlsEnabled(state,{radial:.1}),false);
 state.paused=true;assert.equal(advancePartAngle(1,motor,motor.spin[mode],state,.1),1);
 operatingCases++;
}
for(const id of ['EXT-040','EXT-041','EXT-042']){
 const p=byId[id],motion=createDoorMotion(p,{battery:true});assert.ok(motion.endpointResidualMm<.002);
 const radius=motion.closedPosition.distanceTo(motion.pivot);
 for(let i=0;i<=100;i++){
  const q=new T.Quaternion().fromArray(p.poses.stop[1]).slerp(new T.Quaternion().fromArray(p.poses.battery_open[1]),i/100);
  assert.ok(Math.abs(applyHingePose(motion,q).distanceTo(motion.pivot)-radius)<.00001);
 }
}
for(const id of ['EXT-010','BAT-001','BCL-020'])assert.deepEqual(byId[id].poses.battery_open,byId[id].poses.stop);
assert.notDeepEqual(byId['BCL-010'].poses.battery_release,byId['BCL-010'].poses.stop);
for(let i=0;i<=100;i++){const b=batterySequence(i/100);if(b.open>0)assert.equal(b.release,1);}
const raw=gunzipSync(fs.readFileSync('build/exports/model.bin.gz')),pack=gunzipSync(fs.readFileSync('build/exports/model-packed.bin.gz'));
const floats=(b,[o,n])=>new Float32Array(b.buffer,b.byteOffset+o,n);
for(const p of model.parts.filter(p=>p.belt)){
 assert.ok(Object.values(p.belt.modeledMismatchMmS).every(v=>v<.002));
 const vp=viewer.parts.find(q=>q.id===p.id),pp=packed.parts.find(q=>q.id===p.id),pkg=geometryBuffer(vp.package);
 for(let j=0;j<p.meshes.length;j++){
  const m=p.meshes[j],s=floats(raw,m.beltS);assert.deepEqual(s,floats(pack,pp.meshes[j].beltS));assert.deepEqual(s,floats(pkg,vp.meshes[j].beltS));packedDistances+=s.length;
  const idx=new Uint32Array(raw.buffer,raw.byteOffset+m.i[0],m.i[1]);
  for(let i=0;i<idx.length;i+=3){const a=[s[idx[i]],s[idx[i+1]],s[idx[i+2]]];assert.ok(Math.max(...a)-Math.min(...a)<.255);if(Math.max(...a)>p.belt.loopLengthMm-.00002)seamTriangles++;}
 }
 for(const f of [0,.25,.999]){
  const n=32768,L=p.belt.loopLengthMm,mask=Array.from({length:n},(_,i)=>stripeCoverage(i*L/n,L*f,L,1.6)>.5);
  assert.equal(mask.filter((v,i)=>v&&!mask[(i+n-1)%n]).length,1);
 }
 assert.equal(beltTravel(p.belt,0),0);
}
assert.equal(seamTriangles,64);
const report={passed:true,nativeSha256:model.source_sha256,operatingCases,batteryHingeSamples:303,packedDistances,seamTriangles,nativeCueSubstitutions:model.nativeCueSubstitutions,sourceHashes:Object.fromEntries(['operating-state.mjs','operating-pose.mjs','drive-motion.mjs','door-motion.mjs','app.js'].map(f=>[`viewer/${f}`,sha(`viewer/${f}`)])),scope:'Operating state, native sampled poses, hinge path, cue ownership and packed belt phase coordinates. Graphical gestures require separate browser inspection.'};
fs.writeFileSync('build/test-results/operability-tests.json',JSON.stringify(report,null,2)+'\n');console.log('OPERABILITY PASS',operatingCases,packedDistances);
