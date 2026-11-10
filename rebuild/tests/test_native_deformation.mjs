import './test_setup.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {deformationWeights,applyDeformationPositions} from '../viewer/native-deformation.mjs';
import {interpolateSamples} from '../viewer/model-controls.mjs';
import {Matrix4,Vector3,Quaternion} from 'three';
const read=p=>JSON.parse(readFileSync(p));
const model=read('build/exports/model.json'),native=read('build/exports/native-checks.json'),packed=read('build/exports/model-packed.json');
assert.equal(native.native_sha256,model.source_sha256);assert.equal(native.model_sha256,createHash('sha256').update(readFileSync('build/exports/model.json')).digest('hex'));assert(native.native_unchanged);
const raw=gunzipSync(readFileSync('build/exports/model.bin.gz')),compressed=gunzipSync(readFileSync('build/exports/model-packed.bin.gz'));
const parts=model.parts.filter(p=>p.meshes.some(m=>m.deformation));
assert.deepEqual(parts.map(p=>p.id).sort(),['AC31-008','BAT-010','BAT-011','BCL-030','FCR-030','FRL-020','JCK-21','JCK-22','JCK-23','JCK-24','JCK-36','JNT-010','JNT-020','MDR-021','MEDIA-004','MEDIA-006','STF-030','STP-020','SWT-002','SWT-004','SWT-007','TNE-040','WIR-PB-01']);
let scalarComparisons=0,weightComparisons=0,maximumPackingAndMorphErrorMm=0,maximumWeightError=0;
for(const sample of native.deformations)for(const part of parts){
 const data=part.meshes.find(m=>m.deformation).deformation;
 const state={pose:sample.mode,playTravel:sample.mode==='play'?1:0,tone:sample.tone===0?'low':'high',toneTouched:sample.tone!==.5,stopTravel:sample.stop||0,batteryRelease:sample.batteryRelease||0,view:'assembled'};
 const weights=deformationWeights(data,state),expected=sample.weights[part.id];
 // Tape packs follow the tape position, not the poses: in the native file their key rests at 0 in every pose.
 const tape=data.targets.some(t=>t.tape);
 if(tape)assert(expected.every(w=>w===0),part.id+': a tape key is never posed');
 for(let i=0;i<weights.length&&!tape;i++){
  // The UI has two detents; compare intermediate native cam samples independently of that interaction policy.
  if(data.targets[i].controlCurve?.channel==='tone')weights[i]=interpolateSamples(data.targets[i].controlCurve.samples,sample.tone,'weight')-data.targets[i].initial;
  const error=Math.abs(weights[i]+data.targets[i].initial-expected[i]);maximumWeightError=Math.max(error,maximumWeightError);
  assert(error<.0005,part.id+'/'+sample.tone+'/'+sample.mode+': native curve mismatch '+error);weightComparisons++;
 }
 for(const view of ['service','exploded','catalog']){
  if(tape)break;
  if(['BCL-030','STP-020','STF-030'].includes(part.id)&&view==='service')continue;
  if(!['BCL-030','STP-020','STF-030','BAT-010','BAT-011','MDR-021','AC31-008','JCK-21','JCK-22','JCK-23','JCK-24','JCK-36'].includes(part.id))assert(part.rest_when_separated);   // the springs stay on the cells, which travel with the case; what the plugs move rests because separated views show the accessories unplugged
  for(const value of deformationWeights(data,{...state,view}))assert(Math.abs(value)<1e-6,part.id+': separated deformation');
 }
 for(let mi=0;mi<part.meshes.length;mi++){
  const mesh=part.meshes[mi];if(!mesh.deformation)continue;
  const pack=packed.parts.find(p=>p.id===part.id).meshes[mi];assert.deepEqual(mesh.deformation,pack.deformation);
  const base=new Float32Array(raw.buffer,raw.byteOffset+mesh.p[0],mesh.p[1]),encoded=new Uint16Array(compressed.buffer,compressed.byteOffset+pack.p[0],pack.p[1]);
  const displayBase=Float32Array.from(encoded,(v,i)=>v*pack.pscale[i%3]+pack.pmin[i%3]);
  const original=applyDeformationPositions(base,mesh.deformation.targets,weights),display=applyDeformationPositions(displayBase,mesh.deformation.targets,weights);
  for(let i=0;i<original.length;i++){maximumPackingAndMorphErrorMm=Math.max(maximumPackingAndMorphErrorMm,Math.abs(original[i]-display[i]));scalarComparisons++;}
  assert.deepEqual(applyDeformationPositions(base,mesh.deformation.targets,weights.map(()=>0)),base);
 }
}
// The plug-in states: each sample's shape keys from the exported curves, and each accessory part's place from the
// exported mouth and seated places, against fresh native evaluations along the insertion.
const C=new Matrix4(),mm=new Matrix4(),rest=new Vector3(),pos=new Vector3(),q=new Quaternion(),scale=new Vector3();let plugComparisons=0,maximumPlugPositionErrorMm=0;
assert(native.plugs.length>=3*57,'plug samples');
for(const sample of native.plugs){
 const plugs={[sample.accessory]:{shown:sample.state,insertion:sample.insertion}};
 for(const part of parts){
  const data=part.meshes.find(m=>m.deformation).deformation;if(data.targets.some(t=>t.tape))continue;
  const weights=deformationWeights(data,{pose:'stop',view:'assembled',plugs}),expected=sample.weights[part.id];
  for(let i=0;i<weights.length;i++){const error=Math.abs(weights[i]+data.targets[i].initial-expected[i]);maximumWeightError=Math.max(error,maximumWeightError);assert(error<.0005,part.id+'/'+sample.state+'/'+sample.insertion+': plug curve mismatch '+error);plugComparisons++;}
 }
 for(const [id,matrix] of Object.entries(sample.matrices)){
  const ends=model.parts.find(p=>p.id===id).plugPoses[sample.state];assert(ends,id+': no plug pose for '+sample.state);
  pos.fromArray(ends[0][0]).lerp(rest.fromArray(ends[1][0]),sample.insertion);q.fromArray(ends[1][1]);
  mm.compose(pos,q,scale.fromArray(ends[1][2]));C.fromArray(matrix.flat()).transpose();
  const size=Math.max(...ends[1][2]);   // the native matrices carry the metre-to-millimetre scale
  for(let i=0;i<16;i++){const error=Math.abs(mm.elements[i]-C.elements[i]);if(i>=12)maximumPlugPositionErrorMm=Math.max(maximumPlugPositionErrorMm,error);assert(error<(i>=12?.002:1e-6*size),id+'/'+sample.state+'/'+sample.insertion+': plug pose mismatch '+error);}
 }
}
assert(maximumPackingAndMorphErrorMm<.002);assert.throws(()=>applyDeformationPositions(new Float32Array(3),[{positions:[0]}],[1]),/topology/);
writeFileSync('build/test-results/deformation-tests.json',JSON.stringify({passed:true,nativeSha256:model.source_sha256,nativeSamples:native.deformations.length,weightComparisons,plugSamples:native.plugs.length,plugComparisons,maximumPlugPositionErrorMm,scalarComparisons,maximumWeightError,maximumPackingAndMorphErrorMm,weightTolerance:.0005,positionToleranceMm:.002,scope:'Independent native mode and dense tone samples; exact reset; service/exploded deformation overrides; packed surface transfer. No physical spring performance claim.'},null,2)+'\n');
console.log('NATIVE DEFORMATION PASS',weightComparisons,maximumWeightError,maximumPackingAndMorphErrorMm);
