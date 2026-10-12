import '../test_setup.mjs';
import {pageHtml,modelFile,geometryBytes,geometryBuffer,viewFiles,buildRecord,fakeDocument} from '../kit_files.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {assertInventoryCoverage} from '../inventory_contract.mjs';
import {defaultMeshes} from '../../viewer/exterior.mjs';
const read=p=>JSON.parse(readFileSync(p));
const native=read('build/exports/model.json'),model=read('build/viewer-data/model.json'),packages=read('build/viewer-data/packages.json'),build=buildRecord(),fixture=read('tests/reference/battery-probes.json');
assertInventoryCoverage(native);assertInventoryCoverage(model);
const raw=gunzipSync(readFileSync('build/exports/model.bin.gz')),ids=fixture.parts,byId=new Map(native.parts.map(p=>[p.id,p]));
const material=new T.MeshBasicMaterial({side:T.DoubleSide});
const matrix=poses=>new T.Matrix4().compose(new T.Vector3(...poses.stop[0]),new T.Quaternion(...poses.stop[1]),new T.Vector3(...poses.stop[2]));
function meshes(part){return defaultMeshes(part,native.exterior).map(chunk=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array(raw.buffer,raw.byteOffset+chunk.p[0],chunk.p[1]),3));g.setIndex(new T.BufferAttribute(new Uint32Array(raw.buffer,raw.byteOffset+chunk.i[0],chunk.i[1]),1));const m=new T.Mesh(g,material);m.matrixAutoUpdate=false;m.matrix.copy(matrix(part.poses));m.updateMatrixWorld(true);return m;});}
const current=new Map(ids.map(id=>[id,meshes(byId.get(id))]));
const close=(a,b,e,label)=>assert(Math.abs(a-b)<=e,label+': '+a+' / '+b);
for(const id of ids){
 const after=new T.Box3();current.get(id).forEach(m=>after.expandByObject(m));
 const staged=model.parts.find(p=>p.id===id);for(const edge of ['min','max'])for(let i=0;i<3;i++)close(staged.authoritativeBounds[edge][i],after[edge].getComponent(i),.00002,id+' native bounds');
}
const cast=(id,origin,direction,range=8)=>new T.Raycaster(new T.Vector3(...origin),new T.Vector3(...direction),0,range).intersectObjects(current.get(id),false);
for(const probe of fixture.protectedCabinetRays){
 const all=cast('EXT-010',probe.origin,probe.direction,probe.range).map(h=>h.distance).sort((a,b)=>a-b),distances=all.filter((v,i)=>!i||v-all[i-1]>.0001);
 assert.equal(distances.length,probe.distances.length,'Protected cabinet surface count');distances.forEach((v,i)=>close(v,probe.distances[i],.002,'Protected cabinet surface'));
}
for(const id of ['BCL-010','BCL-020','BCL-030'])for(const chunk of byId.get(id).meshes){
 const m=native.materials[chunk.m],expected=fixture.catch_material;
 if(id==='BCL-010'){assert.equal(m.name,expected.name);for(let i=0;i<3;i++)close(m.color[i],expected.color[i],1e-7,'catch color');for(const key of ['metalness','roughness','alpha'])close(m[key],expected[key],1e-7,'catch '+key);}
 else assert(m.metalness>=.75,id+' metal');
}
const d=fixture.dimensions_mm,skin=hits=>hits.find(h=>h.point.z>=d.rear_skin_z[0]-.003&&h.point.z<=d.rear_skin_z[1]+.003);let closureRays=0;
for(const x of [-30,-20,0,10]){
 const origin=[x,d.cabinet_aperture_edge_y+1,d.rear_skin_z[0]-1];
 assert(skin(cast('EXT-010',origin,[0,0,1])));assert(!skin(cast('EXT-040',origin,[0,0,1])));
 assert(skin(cast('EXT-040',[x,d.lid_top_y-.15,d.rear_skin_z[0]-1],[0,0,1])));
 for(const id of ['EXT-010','EXT-040'])assert(!cast(id,[x,(d.lid_top_y+d.cabinet_aperture_edge_y)/2,d.rear_skin_z[0]-1],[0,0,1]).some(h=>Math.abs(h.point.z-d.rear_skin_z[0])<.02));
 closureRays++;
}
const p=fixture.wall_patch_mm;
for(const tx of [.15,.35,.55,.75,.9])for(const tz of [.2,.5,.8]){
 const x=T.MathUtils.lerp(...p.x,tx),z=T.MathUtils.lerp(...p.z,tz);
 assert(cast('BAT-001',[x,p.y[1]+2,z],[0,-1,0]).some(h=>Math.abs(h.point.y-p.y[1])<.002));closureRays++;
}
assert.equal(packages.batteryCase,undefined);assert.equal(model.alternatives.batteryCase,undefined);
assert(model.inspectionContexts.batteryHousing.partIds.includes('EXT-010'));assert(model.inspectionContexts.batteryHousing.partIds.includes('BAT-001'));assert(!model.inspectionContexts.batteryHousing.partIds.includes('EXT-040'));
for(const id of ids){const part=model.parts.find(p=>p.id===id);assert(packages[part.package]);assert(part.meshes.length);}
assert.equal(createHash('sha256').update(pageHtml()).digest('hex'),build.outputs['index.html']);
assert(!viewFiles().some(f=>/battery/i.test(f)),'The battery case must not be a separate geometry file');
writeFileSync('build/test-results/battery-housing-tests.json',JSON.stringify({passed:true,nativeSha256:native.source_sha256,owners:ids.length,protectedCabinetRays:fixture.protectedCabinetRays.length,closureRays,scope:'Frozen baseline geometry, materials, poses and wire endpoints; authoritative bounds; cabinet surface probes; 19 seam/wall probes; integrated packages. Historical pre-correction comparisons remain in private baseline records. No physical clearance certification.'},null,2)+'\n');
console.log('BATTERY HOUSING PASS',ids.length,fixture.protectedCabinetRays.length,closureRays);
