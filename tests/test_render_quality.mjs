import './test_setup.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PerspectiveCamera,Vector3,MathUtils} from 'three';

// Exercise the shipped camera code against the actual Three projection matrix.
const source=await readFile('viewer/app-camera.mjs','utf8');
const camera=new PerspectiveCamera(32,1,.3,8000),orbit={target:new Vector3()};
const {updateClipRange,renderPixelRatio}=await import('../viewer/app-camera.mjs'),api={updateClipRange:()=>updateClipRange(camera,orbit.target),renderPixelRatio};
const depth=(cam,z)=>(new Vector3(0,0,-z).applyMatrix4(cam.projectionMatrix).z+1)/2;
const levels=(cam,z,gap)=>Math.abs(depth(cam,z)-depth(cam,z+gap))*((2**24)-1);
const cases=[];
for(const distance of [6,20,80,200,340,416,800,2150,3200]){
 camera.position.set(0,0,distance);api.updateClipRange();
 assert(camera.near>0&&camera.near<distance*.5&&camera.far>distance+500,'inspection clipping margin');
 for(const gap of [.01,.018]){
  const separation=levels(camera,distance,gap);
  assert(separation>=3,'native thin layers must span at least three 24-bit depth levels');
  if(distance<=800)assert(levels(camera,distance,gap*Math.cos(75*Math.PI/180))>=3,'oblique overview layer precision');
  cases.push({distance_mm:distance,gap_mm:gap,depth_levels:+separation.toFixed(2)});
 }
}
const old=new PerspectiveCamera(32,1,.3,8000);
camera.position.set(0,0,400);api.updateClipRange();
const before=levels(old,400,.01),after=levels(camera,400,.01);
assert(before<1&&after>40,'regression must reproduce and resolve overview quantization');
for(const [w,h,dpr] of [[390,650,3],[1280,850,2],[3840,2160,2]]){
 const ratio=api.renderPixelRatio(w,h,dpr);
 assert(w*h*ratio*ratio<=2500001&&ratio<=dpr&&ratio<=2,'pixel budget');
}
const model=JSON.parse(await readFile('build/exports/model.json'));
const report={gate:'PASS',nativeSha256:model.source_sha256,sourceHashes:{'viewer/app-camera.mjs':createHash('sha256').update(source).digest('hex')},source:'exported native layers; geometry is diagnostic evidence, not physical verification',depth_bits_assumed:24,geometry_change_mm:0,battery_layer_gap_mm:.01,artwork_gap_mm:.018,overview_depth_levels:{before,after},cases,pixel_budget:2500000,limitations:['Physical phone GPU and display not tested.','Subpixel silhouettes and specular aliasing can remain.']};
await writeFile('build/test-results/render-quality-tests.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({gate:report.gate,layer_cases:cases.length,overview_precision_gain:after/before,pixel_budget:report.pixel_budget}));
