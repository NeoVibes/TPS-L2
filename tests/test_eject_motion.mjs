import './test_setup.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {createOperatingState,dispatchOperating,advanceOperating,resetOperating} from '../viewer/operating-state.mjs';
import {ejectTravel,cassetteLift,applyArticulation} from '../viewer/eject-motion.mjs';
import {mergeOwnerGeometries} from '../viewer/owner-geometry.mjs';
const model=JSON.parse(fs.readFileSync('build/exports/model.json')),packed=JSON.parse(fs.readFileSync('build/exports/model-packed.json')),p=model.parts.find(p=>p.id==='STP-003'),a=p.meshes.filter(m=>m.articulation),contact=p.ejectContact;
assert(a.length>0);assert.deepEqual(packed.parts.find(x=>x.id===p.id).meshes.map(m=>m.articulation),p.meshes.map(m=>m.articulation));
let cases=0;
for(const view of ['assembled','service'])for(const speed of [.05,.55,1,2])for(const media of ['loaded','removed']){
 const s=createOperatingState({view,speed,media,door:true,mode:'play'});dispatchOperating(s,{type:'stop-eject'});advanceOperating(s,.09/speed);assert.equal(ejectTravel(s),0);advanceOperating(s,.6/speed);assert.equal(s.mode,'stop');assert.equal(ejectTravel(s),0);
 dispatchOperating(s,{type:'stop-eject'});advanceOperating(s,.09/speed);assert(Math.abs(ejectTravel(s)-.5)<1e-9);const lift=cassetteLift(contact,ejectTravel(s));assert(lift>=0);dispatchOperating(s,{type:'pause'});const before=JSON.stringify(s);advanceOperating(s,10);assert.equal(JSON.stringify(s),before);dispatchOperating(s,{type:'pause'});advanceOperating(s,.09/speed);assert.equal(ejectTravel(s),1);advanceOperating(s,.42/speed);assert.equal(ejectTravel(s),media==='loaded'?1:0);
 s.view='exploded';assert.equal(ejectTravel(s),0);s.view=view;assert.equal(ejectTravel(s),media==='loaded'?1:0);resetOperating(s);assert.equal(ejectTravel(s),0);cases++;
}
const mesh=new T.Object3D(),spec=a[0].articulation,pivot=new T.Vector3().fromArray(spec.pivot),q=new T.Vector3(9.2,42.1,3.5);let maxPivotError=0;
for(let i=0;i<=100;i++){applyArticulation(mesh,spec,i/100);mesh.updateMatrix();maxPivotError=Math.max(maxPivotError,pivot.clone().applyMatrix4(mesh.matrix).distanceTo(pivot));assert(Math.abs(mesh.quaternion.length()-1)<1e-12);}assert(maxPivotError<1e-10);applyArticulation(mesh,spec,0);assert.equal(mesh.position.length(),0);assert.equal(mesh.quaternion.w,1);
const g=new T.BoxGeometry(1,1,1);g.clearGroups();g.userData.nativeArticulation=spec;const records=[{geometry:g,materialIndex:0,ownerId:p.id},{geometry:g.clone(),materialIndex:0,ownerId:p.id}];assert.equal(mergeOwnerGeometries(records,[{opacity:1}]).length,2);
assert(cassetteLift(contact,1)>3&&cassetteLift(contact,1)<4);assert.equal(cassetteLift(contact,0),0);
fs.writeFileSync('build/test-results/eject-motion-tests.json',JSON.stringify({passed:true,nativeSha256:model.source_sha256,cases,articulatedChunks:a.length,maxPivotError,cassetteLiftMm:cassetteLift(contact,1),scope:'Typed native articulation retained through packing; rigid pivot; merge isolation; first STOP versus EJECT, loaded/empty, pause, speed, service, separation, reassembly and reset. Hidden contact and factory accuracy remain unresolved.'},null,2)+'\n');console.log('EJECT MOTION PASS',cases);
