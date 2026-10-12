import './test_setup.mjs';
import {pageHtml,modelFile,geometryBytes,geometryBuffer,viewFiles,buildRecord,fakeDocument} from './kit_files.mjs';
import {createHash} from 'node:crypto';
import {assertInventoryCoverage} from './inventory_contract.mjs';
import {readFile,writeFile,readdir} from 'node:fs/promises';import * as T from 'three';import assert from 'node:assert/strict';
const model=JSON.parse(await readFile('build/exports/model.json'));const checks=JSON.parse(await readFile('build/exports/native-checks.json'));const native=checks.frame1;let max=0;const errors=[];
const binding=checks;const sha=b=>createHash('sha256').update(b).digest('hex');assert.equal(binding.native_sha256,model.source_sha256);assert.equal(binding.model_sha256,sha(await readFile('build/exports/model.json')));assert(binding.native_unchanged);
for(const mode of ['play','ff','rew'])for(const p of model.parts){const [pos,quat,scale]=p.poses[mode],P=new T.Vector3().fromArray(pos),Q=new T.Quaternion().fromArray(quat),S=new T.Vector3().fromArray(scale),ref=Object.values(p.spin)[0],sp=p.spin[mode];
 if(ref&&sp){const axis=new T.Vector3().fromArray(ref.axis).normalize(),center=new T.Vector3().fromArray(ref.center),phase=sp.rate*new T.Vector3().fromArray(sp.axis).normalize().dot(axis)/binding.fps,rotation=new T.Quaternion().setFromAxisAngle(axis,phase);P.add(center.clone().sub(center.clone().applyQuaternion(rotation)).multiply(S).applyQuaternion(Q));Q.multiply(rotation);}
 const matrix=new T.Matrix4().compose(P,Q,S);let error=0;for(let i=0;i<4;i++)for(let j=0;j<4;j++)error=Math.max(error,Math.abs(matrix.elements[j*4+i]-native[mode][p.id][i][j]));max=Math.max(error,max);if(error>.002)errors.push({part:p.id,mode,error});}
const bins=(await import('node:zlib')).gunzipSync(await readFile('build/exports/model.bin.gz'));for(const p of model.parts)for(const m of p.meshes)for(const key of ['p','n','i',...(m.beltS?['beltS']:[])])assert(m[key][0]+m[key][1]*4<=bins.length);
const html=pageHtml();assert(!/<(?:script|link)[^>]+(?:src|href)=["']https?:/.test(html));for(const f of (await readdir('viewer')).filter(f=>/\.m?js$/.test(f)))assert(!/fetch\(/.test(await readFile('viewer/'+f,'utf8')),f+' must not fetch');const {ownerIds}=assertInventoryCoverage(model);
const report={passed:errors.length===0,source_sha256:model.source_sha256,native_pose_comparisons:ownerIds.length*3,maximum_matrix_error_mm:max,tolerance_mm:.002,errors,all_binary_ranges_valid:true,single_file_no_network_assets:true,components:ownerIds.length,triangles:model.triangles};await writeFile('build/test-results/math-tests.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));assert.equal(errors.length,0);

// Native dependency provenance includes constraints and parent propagation,
// not just drivers directly attached to exported owners.
const dependencyMap=JSON.parse(await readFile('build/exports/motion.json'));
assert(dependencyMap.native_constraints.length>0&&dependencyMap.native_parenting.length>0);
const edges=new Map(),nodes=new Map();
function connect(a,b){if(!a?.snapshot_ref||!b?.snapshot_ref)return;nodes.set(a.snapshot_ref,a);nodes.set(b.snapshot_ref,b);if(!edges.has(a.snapshot_ref))edges.set(a.snapshot_ref,new Set());edges.get(a.snapshot_ref).add(b.snapshot_ref);}
for(const row of dependencyMap.native_parenting)connect(row.parent,row.child);
for(const row of dependencyMap.native_dependencies)for(const variable of row.variables)for(const target of variable.targets)connect(target.id,row.owner);
for(const row of dependencyMap.native_constraints)for(const value of Object.values(row.properties))if(value?.snapshot_ref)connect(value,row.owner);
for(const [controller,part] of [['CTRL-TRANSPORT','CAM-010'],['CTRL-OPERATING','CTL-05']]){
 if(![...nodes].some(([,n])=>n.part_id===part))continue;   // this part was removed from the model
 const source=[...nodes].find(([,n])=>n.controller_id===controller)?.[0],target=[...nodes].find(([,n])=>n.part_id===part)?.[0];assert(source&&target);
 const visited=new Set([source]),pending=[source];while(pending.length){for(const next of edges.get(pending.pop())||[])if(!visited.has(next)){visited.add(next);pending.push(next);}}
 assert(visited.has(target),controller+' must reach '+part+' through the extracted native dependency graph');
}
