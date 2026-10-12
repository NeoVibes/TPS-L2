import './test_setup.mjs';
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {BufferAttribute, BufferGeometry} from 'three';
import {mergeOwnerGeometries} from '../viewer/owner-geometry.mjs';

const metadataBytes=await readFile('build/exports/model-packed.json');
const model=JSON.parse(metadataBytes), compressed=await readFile('build/exports/model-packed.bin.gz');
const bytes=gunzipSync(compressed), raw=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length);
const sha=value=>createHash('sha256').update(value).digest('hex');
let before=0,after=0,triangleCount=0,attributeComparisons=0;
const changed=[];
for(const part of model.parts){
  const records=part.meshes.map(mesh=>{
    const source=new Uint16Array(raw,...mesh.p),positions=new Float32Array(source.length);
    for(let i=0;i<source.length;i++)positions[i]=source[i]*mesh.pscale[i%3]+mesh.pmin[i%3];
    const geometry=new BufferGeometry();
    geometry.setAttribute('position',new BufferAttribute(positions,3));
    geometry.setAttribute('normal',new BufferAttribute(new Int16Array(raw,...mesh.n),3,true));
    geometry.setIndex(new BufferAttribute(mesh.indexType==='u16'?new Uint16Array(raw,...mesh.i):new Uint32Array(raw,...mesh.i),1));
    if(mesh.beltS)geometry.setAttribute('beltS',new BufferAttribute(new Float32Array(raw,...mesh.beltS),1));
    if(mesh.deformation)geometry.userData.nativeDeformation=mesh.deformation;
    if(mesh.articulation)geometry.userData.nativeArticulation=mesh.articulation;
    return {geometry,materialIndex:mesh.m,ownerId:part.id};
  });
  const merged=mergeOwnerGeometries(records,model.materials);
  const sources=new Set();
  for(const output of merged){
    let triangleIndex=0;
    for(const sourceIndex of output.sourceChunkIndices){
      assert(!sources.has(sourceIndex),'Source chunk duplicated');sources.add(sourceIndex);
      const input=records[sourceIndex];assert.equal(output.materialIndex,input.materialIndex);assert.equal(output.ownerId,part.id);
      if(input.geometry.userData.nativeDeformation||input.geometry.userData.nativeArticulation)assert.strictEqual(output.geometry,input.geometry,'Native deformation chunks must remain separate');
      if(model.materials[input.materialIndex].alpha<.99)assert.strictEqual(output.geometry,input.geometry,'Transparent geometry must remain separate');
      for(let i=0;i<input.geometry.index.count;i++){
        const originalVertex=input.geometry.index.array[i],mergedVertex=output.geometry.index.array[triangleIndex++];
        for(const name of Object.keys(input.geometry.attributes)){
          const a=input.geometry.getAttribute(name),b=output.geometry.getAttribute(name);
          assert.equal(a.normalized,b.normalized);assert.equal(a.itemSize,b.itemSize);assert.equal(a.array.constructor,b.array.constructor);
          for(let axis=0;axis<a.itemSize;axis++){
            assert.equal(a.array[originalVertex*a.itemSize+axis],b.array[mergedVertex*b.itemSize+axis],`${part.id}/${name} changed`);attributeComparisons++;
          }
        }
      }
      triangleCount+=input.geometry.index.count/3;
    }
    assert.equal(triangleIndex,output.geometry.index.count,'Output has unaccounted triangles');
  }
  assert.equal(sources.size,records.length,'Source chunks dropped');
  before+=records.length;after+=merged.length;
  if(records.length!==merged.length)changed.push({partId:part.id,before:records.length,after:merged.length,saved:records.length-merged.length});
}

function triangle(normalized=true){const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(new Float32Array([0,0,0,1,0,0,0,1,0]),3));g.setAttribute('normal',new BufferAttribute(normalized?new Int16Array([0,0,32767,0,0,32767,0,0,32767]):new Float32Array([0,0,1,0,0,1,0,0,1]),3,normalized));g.setIndex([0,1,2]);return g;}
const opaque={alpha:1},transparent={alpha:.5};
assert.equal(mergeOwnerGeometries([{geometry:triangle(),materialIndex:0},{geometry:triangle(),materialIndex:0}],[transparent]).length,2);
assert.equal(mergeOwnerGeometries([{geometry:triangle(),materialIndex:0},{geometry:triangle(false),materialIndex:0}],[opaque]).length,2);
assert.equal(mergeOwnerGeometries([{geometry:triangle(),materialIndex:0},{geometry:triangle(),materialIndex:1}],[opaque,opaque]).length,2);
assert.throws(()=>mergeOwnerGeometries([{geometry:triangle(),materialIndex:0,ownerId:'A'},{geometry:triangle(),materialIndex:0,ownerId:'B'}],[opaque]),/ownership/);
const broken=triangle();broken.setIndex([0,1,99]);
assert.throws(()=>mergeOwnerGeometries([{geometry:triangle(),materialIndex:0},{geometry:broken,materialIndex:0}],[opaque]),/outside/);
const report={passed:true,nativeSha256:model.source_sha256,metadataSha256:sha(metadataBytes),geometrySha256:sha(compressed),helperSha256:sha(await readFile('viewer/owner-geometry.mjs')),
 beforeDrawChunks:before,afterDrawChunks:after,savedDrawChunks:before-after,ownersChanged:changed.length,trianglesVerified:triangleCount,attributeScalarComparisons:attributeComparisons,
 maximumPositionChangeMm:0,maximumNormalChange:0,sourceTrianglesPreservedExactly:true,componentOwnershipPreserved:true,transparentChunksPreserved:true,
 scope:'Opaque chunks merged only inside an existing component and material; no cross-owner instancing, simplification or geometry modification. FPS still requires named-device browser measurement.',
 changedOwners:changed.sort((a,b)=>b.saved-a.saved)};
await writeFile('build/test-results/owner-merge-tests.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,before,after,saved:before-after,trianglesVerified:triangleCount,attributeScalarComparisons:attributeComparisons}));
