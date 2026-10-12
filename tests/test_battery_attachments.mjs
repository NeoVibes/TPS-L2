import './test_setup.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Matrix4,Vector3,Quaternion} from 'three';
import {createDoorMotion,applyHingePose} from '../viewer/door-motion.mjs';
import {explodedAssemblyId} from '../viewer/exploded-layout.mjs';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const model=read('build/viewer-data/model.json'),attachmentPath='build/exports/native-checks.json',native=read(attachmentPath);
assert(native.native_unchanged);assert.equal(native.native_sha256,model.source_sha256);
const ids=['EXT-040','EXT-041','EXT-042'],parts=Object.fromEntries(model.parts.map(p=>[p.id,p])),hinges=Object.fromEntries(ids.map(id=>[id,createDoorMotion(parts[id],{battery:true})]));
const scaled=structuredClone(parts['EXT-042']);scaled.poses.battery_open[2][1]+=0.01;assert.throws(()=>createDoorMotion(scaled,{battery:true}),/scale changes/);
let maxPointError=0,comparisons=0;
for(const sample of native.battery){
 for(const id of ids){
  const h=hinges[id],q=h.closedQuaternion.clone().slerp(h.openQuaternion,sample.progress),position=applyHingePose(h,q),m=new Matrix4().compose(position,q,new Vector3(...parts[id].poses.stop[2]));
  const expected=new Matrix4().set(...sample.matrices[id].flat());
  for(const point of [[-28,-64.6,-14.44],[3.5,-53.6,-14.38],[-12,-58,-14.4]]){
   const actual=new Vector3(...point).applyMatrix4(m),ref=new Vector3(...point).applyMatrix4(expected);maxPointError=Math.max(maxPointError,actual.distanceTo(ref));comparisons++;
  }
  assert.equal(explodedAssemblyId(parts[id]),'battery-door');
 }
}
assert(maxPointError<.002,maxPointError);
assert.deepEqual(parts['EXT-042'].service,parts['EXT-040'].service,'Applied label must remain with service lid');
const screws=['SCR-F01','SCR-F02','SCR-R01','SCR-R02','SCR-T01','SCR-T02','SCR-T03'];
for(const id of [...screws,'EXT-052','EXT-042']) assert.equal(parts[id].package,'exterior',id+' must be present in the cold-load closed-cover package');
for(const id of screws) assert.deepEqual(parts[id].poses.stop,parts[id].poses.battery_open,id+' must not move or disappear with lid operation');
const report={passed:true,nativeSha256:model.source_sha256,nativeReadOnly:true,independentNativeSamples:native.battery.length,pointComparisons:comparisons,maxPointErrorMm:maxPointError,exteriorScrews:screws,sourceHashes:Object.fromEntries(['viewer/door-motion.mjs','tools/build_viewer.mjs','tests/test_battery_attachments.mjs','build/viewer-data/model.json',attachmentPath].map(p=>[p,sha(p)])),scope:'Independent native opening/reversal poses versus browser hinge evaluation for lid and both labels; coherent service/exploded ownership; exposed screws and collar available on cold-load and closed-cover exterior rendering.'};
fs.writeFileSync('build/test-results/battery-attachment-tests.json',JSON.stringify(report,null,2)+'\n');console.log('BATTERY ATTACHMENTS PASS',comparisons,maxPointError);
