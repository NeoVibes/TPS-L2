import './test_setup.mjs';
import assert from 'node:assert/strict';
import {Box3,Vector3,PerspectiveCamera} from 'three';
import {readFileSync,writeFileSync} from 'node:fs';
import {fitBoxDistance} from '../viewer/fit-camera.mjs';
const model=globalThis.portableTapePlayerData.model.meta;
let checks=0;
for(const key of ['beltDrive','motorCutaway']){
 const context=model.inspectionContexts[key],box=new Box3();
 for(const id of context.partIds){const b=model.parts.find(p=>p.id===id).authoritativeBounds;box.union(new Box3(new Vector3(...b.min),new Vector3(...b.max)));}
 for(const aspect of [.32,.55,1,1.7,3]){
  const camera=new PerspectiveCamera(32,aspect,.01,10000),direction=new Vector3(...(key==='motorCutaway'?[.75,-.8,-.35]:[0,.2,-1])).normalize();
  camera.up.set(...(key==='motorCutaway'?[0,0,1]:[0,1,0]));
  const center=box.getCenter(new Vector3()),distance=fitBoxDistance(box,direction,camera.up,aspect);
  camera.position.copy(center).addScaledVector(direction,distance);camera.lookAt(center);camera.updateMatrixWorld();
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
   const projected=new Vector3(x,y,z).project(camera);
   assert(Math.abs(projected.x)<=.820001&&Math.abs(projected.y)<=.820001&&projected.z<1);checks++;
  }
 }
}
writeFileSync('build/test-results/camera-fit-tests.json',JSON.stringify({passed:true,nativeSha256:model.source_sha256,checks,scope:'Actual exported belt and motor bounds fit both axes at five wide/narrow aspect ratios; independent camera projection.'},null,2)+'\n');
console.log('Camera fit passed',checks,'projected corners');
