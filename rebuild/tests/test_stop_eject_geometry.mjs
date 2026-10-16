import './test_setup.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const model=JSON.parse(fs.readFileSync('build/exports/model.json'));
for(const id of ['CTL-04','STP-002']){const p=model.parts.find(p=>p.id===id);assert(Math.abs(p.poses.eject[0][0]-p.poses.stop[0][0]+1)<.00001);}
const spring=model.parts.find(p=>p.id==='STP-020');assert(spring.meshes.every(m=>m.deformation));assert.equal(spring.meshes[0].deformation.targets[0].weights.eject,1);
const lid=model.parts.find(p=>p.id==='EXT-040');assert(lid.meshes.every(m=>model.materials[m.m].name==='Housing study • plain muted blue'));
const fixed=model.parts.find(p=>p.id==='STP-003');assert.deepEqual(fixed.poses.stop,fixed.poses.eject,'Fixed EJECT mounting must stay stationary while its child rocker moves');
fs.writeFileSync('build/test-results/stop-eject-geometry-tests.json',JSON.stringify({passed:true,nativeSha256:model.source_sha256,scope:'Native cap, slide, spring, fixed EJECT mounting and battery-door material.'},null,2)+'\n');
console.log('STOP/EJECT native geometry passed');
