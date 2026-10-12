import './test_setup.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {deformationWeights,applyDeformationPositions} from '../viewer/native-deformation.mjs';
import {interpolateSamples} from '../viewer/model-controls.mjs';
const read=p=>JSON.parse(readFileSync(p));
const model=read('build/exports/model.json'),native=read('build/exports/native-checks.json'),packed=read('build/exports/model-packed.json');
assert.equal(native.native_sha256,model.source_sha256);assert.equal(native.model_sha256,createHash('sha256').update(readFileSync('build/exports/model.json')).digest('hex'));assert(native.native_unchanged);
const raw=gunzipSync(readFileSync('build/exports/model.bin.gz')),compressed=gunzipSync(readFileSync('build/exports/model-packed.bin.gz'));
const parts=model.parts.filter(p=>p.meshes.some(m=>m.deformation));
assert.deepEqual(parts.map(p=>p.id).sort(),['BCL-030','FCR-030','JNT-010','JNT-020','STP-020','TNE-040']);
let scalarComparisons=0,weightComparisons=0,maximumPackingAndMorphErrorMm=0,maximumWeightError=0;
for(const sample of native.deformations)for(const part of parts){
 const data=part.meshes.find(m=>m.deformation).deformation;
 const state={pose:sample.mode,playTravel:sample.mode==='play'?1:0,tone:sample.tone===0?'low':'high',toneTouched:sample.tone!==.5,stopTravel:sample.stop||0,batteryRelease:sample.batteryRelease||0,view:'assembled'};
 const weights=deformationWeights(data,state),expected=sample.weights[part.id];
 for(let i=0;i<weights.length;i++){
  // The UI has two detents; compare intermediate native cam samples independently of that interaction policy.
  if(data.targets[i].controlCurve?.channel==='tone')weights[i]=interpolateSamples(data.targets[i].controlCurve.samples,sample.tone,'weight')-data.targets[i].initial;
  const error=Math.abs(weights[i]+data.targets[i].initial-expected[i]);maximumWeightError=Math.max(error,maximumWeightError);
  assert(error<.0005,part.id+'/'+sample.tone+'/'+sample.mode+': native curve mismatch '+error);weightComparisons++;
 }
 for(const view of ['service','exploded','catalog']){
  if(['BCL-030','STP-020'].includes(part.id)&&view==='service')continue;
  if(!['BCL-030','STP-020'].includes(part.id))assert(part.rest_when_separated);
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
assert(maximumPackingAndMorphErrorMm<.002);assert.throws(()=>applyDeformationPositions(new Float32Array(3),[{positions:[0]}],[1]),/topology/);
writeFileSync('build/test-results/deformation-tests.json',JSON.stringify({passed:true,nativeSha256:model.source_sha256,nativeSamples:native.deformations.length,weightComparisons,scalarComparisons,maximumWeightError,maximumPackingAndMorphErrorMm,weightTolerance:.0005,positionToleranceMm:.002,scope:'Independent native mode and dense tone samples; exact reset; service/exploded deformation overrides; packed surface transfer. No physical spring performance claim.'},null,2)+'\n');
console.log('NATIVE DEFORMATION PASS',weightComparisons,maximumWeightError,maximumPackingAndMorphErrorMm);
