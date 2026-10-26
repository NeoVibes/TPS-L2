import './test_setup.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Vector3, Quaternion, Matrix4 } from 'three';
import { DOOR_PART_IDS, createDoorMotion, applyHingePose } from '../viewer/door-motion.mjs';

const model = JSON.parse(await readFile('build/exports/model.json'));
const reference=JSON.parse(await readFile('build/exports/native-checks.json'));assert.equal(reference.native_sha256,model.source_sha256);assert(reference.native_unchanged);
const shaft = model.parts.find(p => p.id === 'HINGE-010');
assert.deepEqual(shaft.poses.stop,shaft.poses.open,'The shaft is stationary while the lid opens');
const movingDoorParts = model.parts.filter(p => p.group === 'lid and glazing' && JSON.stringify(p.poses.stop) !== JSON.stringify(p.poses.open));
assert.deepEqual(movingDoorParts.map(p => p.id).sort(), [...DOOR_PART_IDS].sort());
assert.equal(createDoorMotion(shaft),null);
const toleranceMm = .002, result = [];
let maximumAxisDriftMm = 0, maximumEndpointErrorMm = 0, maximumReferenceErrorMm = 0, oldMaximumAxisDriftMm = 0;

for (const part of movingDoorParts) {
  const motion = createDoorMotion(part);
  const stop = part.poses.stop, open = part.poses.open;
  const closedMatrixPoint = world => world.clone().sub(motion.closedPosition).applyQuaternion(motion.inverseClosedQuaternion);
  const axisLocal = closedMatrixPoint(motion.pivot);
  const samples = [];
  // Independent native evaluations provide the reference path.
  // Compare three off-axis landmarks against evaluated native matrices,
  // rather than testing the helper only against itself.
  const landmarks = [new Vector3(0,0,0),new Vector3(28.7,45.9,14.8),new Vector3(-23.45,-43.85,15.22)];
  for (let i=0;i<reference.doors.length;i++) {
    // Native Door is a control value, not the viewer's interpolation fraction:
    // its current driver reaches the lid's 92.5° limit at 0.925. Compare the same
    // evaluated orientation so viewer timing remains independent of native travel.
    const progress=reference.doors[i].progress, referenceMatrix=new Matrix4().set(...reference.doors[i].matrices[part.id].flat());
    const q=new Quaternion(),referenceScale=new Vector3();referenceMatrix.decompose(new Vector3(),q,referenceScale);q.normalize();
    const position=applyHingePose(motion,q), axisWorld=axisLocal.clone().applyQuaternion(q).add(position);
    maximumAxisDriftMm=Math.max(maximumAxisDriftMm,axisWorld.distanceTo(motion.pivot));
    const linear=new Vector3().fromArray(stop[0]).lerp(new Vector3().fromArray(open[0]),progress);
    const oldDrift=axisLocal.clone().applyQuaternion(q).add(linear).distanceTo(motion.pivot);
    oldMaximumAxisDriftMm=Math.max(oldMaximumAxisDriftMm,oldDrift);
    const matrix=referenceMatrix;
    for(const local of landmarks) {
      // Native matrices include the fixed unit scale; the hinge module returns world positions.
      const expected=local.clone().multiplyScalar(1/stop[2][0]).applyMatrix4(matrix);
      const actual=local.clone().applyQuaternion(q).add(position);
      maximumReferenceErrorMm=Math.max(maximumReferenceErrorMm,actual.distanceTo(expected));
    }
    if(i%19===0)samples.push({progress,oldAxisDriftMm:oldDrift,newAxisDriftMm:axisWorld.distanceTo(motion.pivot)});
  }
  for(const pose of ['stop','play','ff','rew','open','eject','removed']) {
    const expected=new Vector3().fromArray(part.poses[pose][0]);
    const actual=applyHingePose(motion,new Quaternion().fromArray(part.poses[pose][1]));
    maximumEndpointErrorMm=Math.max(maximumEndpointErrorMm,actual.distanceTo(expected));
    assert.ok(actual.distanceTo(expected)<=toleranceMm,`${part.id}/${pose}: exported endpoint retained`);
  }
  // Reversal does not require a new pivot or a straight-line path between the
  // current translation and the new target. Include repeated partial reversals.
  let q=motion.closedQuaternion.clone();
  for(const [target,frames] of [[motion.openQuaternion,17],[motion.closedQuaternion,9],[motion.openQuaternion,31],[motion.closedQuaternion,200]]) {
    for(let i=0;i<frames;i++) {
      q.slerp(target,1-Math.exp(-.016*7));
      const world=axisLocal.clone().applyQuaternion(q).add(applyHingePose(motion,q));
      assert.ok(world.distanceTo(motion.pivot)<1e-9,'Reversing motion remains coaxial');
    }
  }
  result.push({partId:part.id,pivotMm:motion.pivot.toArray(),axis:motion.axis.toArray(),openAngleDegrees:motion.angle*180/Math.PI,endpointResidualMm:motion.endpointResidualMm,samples});
}
assert.ok(oldMaximumAxisDriftMm>12,'The regression exposes the former detached-hinge motion');   // 13.8 mm at the lid's 92.5°
assert.ok(maximumAxisDriftMm<1e-9);
assert.ok(maximumEndpointErrorMm<toleranceMm);
assert.ok(maximumReferenceErrorMm<toleranceMm);
// Reject a future export that really slides along its axis rather than silently
// forcing that geometry onto a hinge-only motion path.
const axial=structuredClone(movingDoorParts[0]);axial.poses.open[0][1]+=.1;
assert.throws(()=>createDoorMotion(axial),/axial motion/);
const sourceHashes={};
for(const path of ['viewer/door-motion.mjs','tests/test_door_motion.mjs','build/exports/model.json','build/exports/native-checks.json']) sourceHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
const report={passed:true,nativeSha256:model.source_sha256,sourceHashes,numericalToleranceMm:toleranceMm,parts:result,maximumAxisDriftMm,maximumEndpointErrorMm,maximumReferenceErrorMm,oldMaximumAxisDriftMm,scope:'Viewer fixed-axis interpolation and existing export/native-parameter correspondence. No new native collision sweep, factory geometry, shaft fit, retention, or manufacturing accuracy certification.'};
await writeFile('build/test-results/door-motion-tests.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,parts:result.map(({samples,...p})=>p)},null,2));
