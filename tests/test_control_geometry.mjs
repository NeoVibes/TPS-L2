import './test_setup.mjs';
// Read-only geometry audit: independent ray/triangle tests, using current camera
// presets and display motions, with all visible surfaces allowed to occlude.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {runInNewContext} from 'node:vm';
import {PerspectiveCamera,Vector3,Quaternion,Matrix4,Ray} from 'three';
import config from '../config/model.json' with {type:'json'};
import {CONTROL_BINDINGS,controlVisualOffset} from '../viewer/model-controls.mjs';

const start=performance.now(),sourcePaths=['build/exports/model.json','build/exports/model.bin.gz','build/viewer-data/model.json','viewer/app.js','viewer/model-controls.mjs','config/model.json','build/exports/cassette/manifest.json','build/exports/cassette/geometry.bin.gz','tests/test_control_geometry.mjs'];
const input=Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,await readFile(path)])));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceHashes=Object.fromEntries(sourcePaths.map(path=>[path,sha(input[path])]));
const model=JSON.parse(input['build/exports/model.json']),packaged=JSON.parse(input['build/viewer-data/model.json']);
const raw=gunzipSync(input['build/exports/model.bin.gz']),alt=JSON.parse(input['build/exports/cassette/manifest.json']),altRaw=gunzipSync(input['build/exports/cassette/geometry.bin.gz']);
const app=input['viewer/app.js'].toString();
const views=config.viewer.controlCameras;
const packagedById=new Map(packaged.parts.map(part=>[part.id,part])),altById=new Map(alt.parts.map(part=>[part.id,part]));
const vector=a=>new Vector3().fromArray(a);

function rayBox(origin,direction,bounds,limit=Infinity){
 let near=0,far=limit;
 for(let axis=0;axis<3;axis++){
  if(Math.abs(direction[axis])<1e-14){if(origin[axis]<bounds[axis]||origin[axis]>bounds[axis+3])return Infinity;continue;}
  let a=(bounds[axis]-origin[axis])/direction[axis],b=(bounds[axis+3]-origin[axis])/direction[axis];
  if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);if(near>far)return Infinity;
 }
 return near;
}
function rayTriangle(origin,direction,positions,index){
 const at=index*9,ax=positions[at],ay=positions[at+1],az=positions[at+2];
 const ex=positions[at+3]-ax,ey=positions[at+4]-ay,ez=positions[at+5]-az,fx=positions[at+6]-ax,fy=positions[at+7]-ay,fz=positions[at+8]-az;
 const px=direction[1]*fz-direction[2]*fy,py=direction[2]*fx-direction[0]*fz,pz=direction[0]*fy-direction[1]*fx;
 const det=ex*px+ey*py+ez*pz;if(Math.abs(det)<1e-12)return Infinity;
 const inverse=1/det,tx=origin[0]-ax,ty=origin[1]-ay,tz=origin[2]-az,u=(tx*px+ty*py+tz*pz)*inverse;
 if(u<0||u>1)return Infinity;
 const qx=ty*ez-tz*ey,qy=tz*ex-tx*ez,qz=tx*ey-ty*ex,v=(direction[0]*qx+direction[1]*qy+direction[2]*qz)*inverse;
 if(v<0||u+v>1)return Infinity;
 const distance=(fx*qx+fy*qy+fz*qz)*inverse;return distance>=0?distance:Infinity;
}
function buildBVH(positions){
 const count=positions.length/9,indices=Uint32Array.from({length:count},(_,i)=>i),boxes=new Float32Array(count*6);
 for(let tri=0;tri<count;tri++)for(let axis=0;axis<3;axis++){
  boxes[tri*6+axis]=Math.min(positions[tri*9+axis],positions[tri*9+3+axis],positions[tri*9+6+axis]);
  boxes[tri*6+axis+3]=Math.max(positions[tri*9+axis],positions[tri*9+3+axis],positions[tri*9+6+axis]);
 }
 function build(begin,end,depth=0){
  const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(let i=begin;i<end;i++)for(let axis=0;axis<3;axis++){bounds[axis]=Math.min(bounds[axis],boxes[indices[i]*6+axis]);bounds[axis+3]=Math.max(bounds[axis+3],boxes[indices[i]*6+axis+3]);}
  const node={bounds,begin,end};if(end-begin<=16||depth>=40)return node;
  const spans=bounds.slice(0,3).map((value,i)=>bounds[i+3]-value),axis=spans.indexOf(Math.max(...spans)),middle=(bounds[axis]+bounds[axis+3])*.5;
  let left=begin,right=end-1;
  while(left<=right){const tri=indices[left],centre=(boxes[tri*6+axis]+boxes[tri*6+axis+3])*.5;if(centre<middle)left++;else{[indices[left],indices[right]]=[indices[right],indices[left]];right--;}}
  if(left===begin||left===end)left=(begin+end)>>1;
  node.left=build(begin,left,depth+1);node.right=build(left,end,depth+1);return node;
 }
 const root=build(0,count);
 return {root,positions,indices,cast(origin,direction,opaqueFlags,opaqueOnly=false){
  let distance=Infinity,triangle=-1;const stack=[root];
  while(stack.length){const node=stack.pop();if(rayBox(origin,direction,node.bounds,distance)===Infinity)continue;
   if(node.left){const a=rayBox(origin,direction,node.left.bounds,distance),b=rayBox(origin,direction,node.right.bounds,distance);if(a<b){if(b!==Infinity)stack.push(node.right);if(a!==Infinity)stack.push(node.left);}else{if(a!==Infinity)stack.push(node.left);if(b!==Infinity)stack.push(node.right);}continue;}
   for(let i=node.begin;i<node.end;i++){const tri=indices[i];if(opaqueOnly&&!opaqueFlags[tri])continue;const hit=rayTriangle(origin,direction,positions,tri);if(hit<distance){distance=hit;triangle=tri;}}
  }
  return {distance,triangle};
 }};
}

// Known nearer and farther double-sided surfaces establish nearest-hit behavior,
// reverse winding, transparent occlusion, and rays that miss the mesh entirely.
const fixture=buildBVH(new Float32Array([-1,-1,3,1,-1,3,0,1,3,-1,-1,5,0,1,5,1,-1,5]));
assert.equal(fixture.cast([0,0,0],[0,0,1],new Uint8Array([0,1])).distance,3);
assert.equal(fixture.cast([0,0,0],[0,0,1],new Uint8Array([0,1]),true).distance,5);
assert.equal(fixture.cast([2,0,0],[0,0,1],new Uint8Array([1,1])).distance,Infinity);
assert.equal(fixture.cast([0,0,6],[0,0,-1],new Uint8Array([1,1])).distance,1);

const scene=[];
for(const data of model.parts){
 const packagedPart=packagedById.get(data.id);
 if(packagedPart.package!=='exterior'&&!data.is_cassette)continue;
 const alternative=altById.get(data.id),chunks=alternative?.meshes||data.meshes,blob=alternative?altRaw:raw,materials=alternative?alt.materials:model.materials;
 const triangleCount=chunks.reduce((sum,chunk)=>sum+chunk.i[1]/3,0),positions=new Float32Array(triangleCount*9),opaque=new Uint8Array(triangleCount),gripPoints=[];
 let triOffset=0;
 for(const chunk of chunks){
  const vertices=new Float32Array(blob.buffer,blob.byteOffset+chunk.p[0],chunk.p[1]),indices=new Uint32Array(blob.buffer,blob.byteOffset+chunk.i[0],chunk.i[1]);
  for(let i=0;i<indices.length;i++)for(let axis=0;axis<3;axis++)positions[triOffset*9+i*3+axis]=vertices[indices[i]*3+axis];
  const material=materials[chunk.m];opaque.fill((material.alpha??1)>=.99&&(material.transmission??0)===0?1:0,triOffset,triOffset+indices.length/3);
  if(data.id.startsWith('CTL-')&&(!['CTL-05','CTL-06'].includes(data.id)||material.name==='Volume • warm silver grips'))for(let i=0;i<vertices.length;i+=3)gripPoints.push([vertices[i],vertices[i+1],vertices[i+2]]);
  triOffset+=indices.length/3;
 }
 const gripBounds=gripPoints.length?[0,1,2].map(axis=>[Math.min(...gripPoints.map(p=>p[axis])),Math.max(...gripPoints.map(p=>p[axis]))]):null;
 scene.push({data,bvh:buildBVH(positions),opaque,gripBounds,matrix:new Matrix4(),inverse:new Matrix4()});
}
function setState(mode,values){
 for(const part of scene){
  const [p,q,s]=part.data.poses[mode],offset=controlVisualOffset(part.data.id,values);
  part.matrix.compose(vector(p).add(vector(offset)),new Quaternion().fromArray(q),vector(s));part.inverse.copy(part.matrix).invert();
 }
}
const transformedRay=new Ray(),hitPoint=new Vector3();
function cast(ray,opaqueOnly=false){
 let best=null;
 for(const part of scene){
  transformedRay.copy(ray).applyMatrix4(part.inverse);
  const result=part.bvh.cast(transformedRay.origin.toArray(),transformedRay.direction.toArray(),part.opaque,opaqueOnly);
  if(result.distance===Infinity)continue;
  transformedRay.at(result.distance,hitPoint).applyMatrix4(part.matrix);const distance=hitPoint.distanceTo(ray.origin);
  if(!best||distance<best.distance)best={id:part.data.id,distance,point:hitPoint.toArray()};
 }
 return best;
}
const cases=[];
for(const mode of ['stop','play','ff','rew'])for(const id of ['CTL-01','CTL-02','CTL-03','CTL-04'])cases.push({id,camera:'transport',mode,volumeLeft:.5,volumeRight:.5});
for(const volumeLeft of [0,.5,1])for(const volumeRight of [0,.5,1])for(const id of ['CTL-05','CTL-06'])cases.push({id,camera:'transport',mode:'stop',volumeLeft,volumeRight});
for(const hotline of [false,true])cases.push({id:'CTL-07',camera:'hotline',mode:'stop',hotline,volumeLeft:.5,volumeRight:.5});
for(const tone of ['low','high'])cases.push({id:'CTL-08',camera:'tone',mode:'stop',tone,toneTouched:true,volumeLeft:.5,volumeRight:.5});
const results=[],sampleGrid=19;
for(const viewport of [{name:'desktop',width:960,height:720},{name:'portrait',width:390,height:700}])for(const scenario of cases){
 if(!scene.some(part=>part.data.id===scenario.id))continue;   // this control's part was removed from the model
 setState(scenario.mode,scenario);
 const [target,position]=views[scenario.camera],camera=new PerspectiveCamera(32,viewport.width/viewport.height,.25,2000);
 camera.position.fromArray(position);camera.up.set(0,1,0);camera.lookAt(vector(target));camera.updateMatrixWorld();
 const part=scene.find(part=>part.data.id===scenario.id),box=part.gripBounds,corners=[];assert(box,'Visible grip material must resolve for '+scenario.id);
 for(const x of box[0])for(const y of box[1])for(const z of box[2])corners.push(new Vector3(x,y,z).applyMatrix4(part.matrix).project(camera));
 const projected={min:[Math.min(...corners.map(v=>v.x)),Math.min(...corners.map(v=>v.y))],max:[Math.max(...corners.map(v=>v.x)),Math.max(...corners.map(v=>v.y))]};
 const blockers={},opaqueBlockers={};let tested=0,reachable=0,opaqueReachable=0,example=null;
 const ray=new Ray();ray.origin.copy(camera.position);
 for(let x=0;x<sampleGrid;x++)for(let y=0;y<sampleGrid;y++){
  const nx=projected.min[0]+(projected.max[0]-projected.min[0])*(x+.5)/sampleGrid,ny=projected.min[1]+(projected.max[1]-projected.min[1])*(y+.5)/sampleGrid;
  if(Math.abs(nx)>1||Math.abs(ny)>1)continue;
  ray.direction.set(nx,ny,.5).unproject(camera).sub(ray.origin).normalize();tested++;
  const hit=cast(ray),opaqueHit=cast(ray,true);
  if(hit?.id===scenario.id){reachable++;example??={pixel:[(nx+1)*viewport.width/2,(1-ny)*viewport.height/2],worldPoint:hit.point};}else blockers[hit?.id||'background']=(blockers[hit?.id||'background']||0)+1;
  if(opaqueHit?.id===scenario.id)opaqueReachable++;else opaqueBlockers[opaqueHit?.id||'background']=(opaqueBlockers[opaqueHit?.id||'background']||0)+1;
 }
 const centre=new Vector3(...box.map(values=>(values[0]+values[1])/2)).applyMatrix4(part.matrix),axisEnd=centre.clone().add(new Vector3(...(CONTROL_BINDINGS[scenario.id]?.axis||[0,1,0])).multiplyScalar(CONTROL_BINDINGS[scenario.id]?.travelMm||0));
 const a=centre.project(camera),b=axisEnd.project(camera),axisPixels=Math.hypot((a.x-b.x)*viewport.width/2,(a.y-b.y)*viewport.height/2);
 results.push({...scenario,viewport:viewport.name,screenGripBoundsPx:{width:(projected.max[0]-projected.min[0])*viewport.width/2,height:(projected.max[1]-projected.min[1])*viewport.height/2},projectedDragAxisPixels:['CTL-05','CTL-06','CTL-08'].includes(scenario.id)?axisPixels:null,testedSamples:tested,nearestSurfaceControlSamples:reachable,nearestOpaqueControlSamples:opaqueReachable,blockers,opaqueBlockers,example,reachable:reachable>0});
}
for(const path of sourcePaths)assert.equal(sha(await readFile(path)),sourceHashes[path],path+' changed during the audit');
const failed=results.filter(result=>!result.reachable),tinyAxis=results.filter(result=>result.projectedDragAxisPixels!==null&&result.projectedDragAxisPixels<=4);
const report={completed:true,passed:failed.length===0&&tinyAxis.length===0,nativeSha256:model.source_sha256,sourceHashes,fixtureChecksPassed:4,sourceGeometry:'Original full precision exported player; current refined cassette replacement. Same double-sided materials and exterior/media visibility as assembled Operate mode.',cameras:views,viewports:[{width:960,height:720},{width:390,height:700}],sceneParts:scene.length,sceneTriangles:scene.reduce((sum,part)=>sum+part.bvh.positions.length/9,0),cases:results.length,sampleGridPerCase:sampleGrid,failedCases:failed,axesTooShort:tinyAxis,results,elapsedMilliseconds:performance.now()-start,limits:['Finite projected surface sampling, not every screen pixel or every intermediate state.','Uses source float vertices; packed browser geometry may differ by the recorded quantization tolerance.','No browser pointer, overlay, CSS, GPU clipping, mobile touch, or native physical reachability claim.','Nearest visible surface is authoritative for the current viewer, including transparent surfaces; nearest opaque results are also reported for comparison.','Prepared cameras are tested after movement settles, with door closed, media loaded, no clipping or inspection filters.']};
await writeFile('build/test-results/control-geometry-tests.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,cases:report.cases,failed:failed.map(row=>({id:row.id,mode:row.mode,viewport:row.viewport,volumeLeft:row.volumeLeft,volumeRight:row.volumeRight,blockers:row.blockers})),axesTooShort:tinyAxis.length,elapsedMilliseconds:report.elapsedMilliseconds},null,2));
if(!report.passed)process.exitCode=1;
