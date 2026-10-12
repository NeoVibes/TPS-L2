import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import '../rebuild/tests/test_setup.mjs';   // runs from rebuild/ and gives the viewer modules the built model data
import {ROOT,KIT,hash,verifyExports,json} from '../rebuild/tools/integrity.mjs';
import {controlVisualOffset,CONTROL_BINDINGS} from '../rebuild/viewer/model-controls.mjs';
const baseline=path.resolve(process.argv[2]||''),step=process.argv[3];
if(!step||baseline===KIT)throw Error('Usage: node publish/verify_edit.mjs "/path/to/preserved baseline" STEP');
const read=async(root,p)=>JSON.parse(await readFile(path.join(root,p),'utf8'));
const marker=JSON.parse(await readFile(path.join(KIT,'DISPOSABLE-COPY.json'),'utf8'));assert(marker.applied.includes(step),'Requested edit was not applied');
const baselineReceipt=await readFile(path.join(baseline,'rebuild/build/exports/receipt.json'));
assert.equal(hash(baselineReceipt),marker.baselineExportReceiptSHA256,'Baseline receipt changed since the copy was created');
const {model,inventory}=await verifyExports(),before=await read(baseline,'rebuild/build/exports/model.json');
const raw=gunzipSync(await readFile(path.join(ROOT,'build/exports/model.bin.gz'))),oldRaw=gunzipSync(await readFile(path.join(baseline,'rebuild/build/exports/model.bin.gz')));
const chunks=(m,r,p)=>p.meshes.map(mesh=>JSON.stringify({material:m.materials[mesh.m],...Object.fromEntries(['p','n','i'].map(k=>[k,{count:mesh[k][1],hash:hash(r.subarray(mesh[k][0],mesh[k][0]+4*mesh[k][1]))}]))})).sort();
let unchanged=0;const differences=[];
for(const p of before.parts){const current=model.parts.find(x=>x.id===p.id);if(step==='C1-remove'&&p.id==='CTL-05'){assert(!current);differences.push({id:p.id,removed:true});continue;}assert(current,p.id+' disappeared');
 const geometryChanged=JSON.stringify(chunks(model,raw,current))!==JSON.stringify(chunks(before,oldRaw,p));
 const posesChanged=JSON.stringify(current.poses)!==JSON.stringify(p.poses),ratesChanged=JSON.stringify(current.spin)!==JSON.stringify(p.spin);
 const allowedGeometry=step==='B'&&p.id==='BAS-013',allowedMotion=step==='D'&&p.id==='CAM-010';
 if(!allowedGeometry)assert(!geometryChanged,p.id+': unrelated geometry changed');
 if(!allowedMotion){assert(!posesChanged,p.id+': unrelated poses changed');assert(!ratesChanged,p.id+': unrelated native rates changed');}
 if(geometryChanged||posesChanged||ratesChanged)differences.push({id:p.id,geometryChanged,posesChanged,ratesChanged});else unchanged++;
}
const pid=marker.new_part_id;
if(step==='B'){
 assert(differences.some(p=>p.id==='BAS-013'&&p.geometryChanged),'Reshape did not reach the export');
 const a=before.parts.find(p=>p.id==='BAS-013'),b=model.parts.find(p=>p.id===a.id);
 assert.equal(a.meshes.reduce((n,m)=>n+m.i[1],0),b.meshes.reduce((n,m)=>n+m.i[1],0),'Reshape must preserve topology');
}else if(step.startsWith('C1-')){
 if(step==='C1-remove'){
  assert(!model.parts.some(p=>p.id===pid));assert(inventory.missing_owner_ids_reserved.includes(pid));assert(inventory.missing_owner_ids_reserved.includes('CTL-05'));assert(inventory.inactive_binding_references.some(r=>r.part_id==='CTL-05'));assert(!CONTROL_BINDINGS['CTL-05']);
 }else{
  const p=model.parts.find(p=>p.id===pid);assert(p);assert.equal(p.package,'exterior');assert.equal(p.assembly,'ungrouped');assert.equal(p.category,'structure');assert.equal(p.distance,0);assert.deepEqual(p.spin,{});
  const owner=inventory.owners.find(o=>o.part_id===pid);assert.equal(owner.geometry.length,step==='C1-create'?1:2);
  if(step==='C1-rename'){assert.equal(p.name,'Renamed acceptance display');assert.equal(model.parts.find(p=>p.id==='CTL-05').name,'Renamed left volume');assert.equal(CONTROL_BINDINGS['CTL-05'].channel,'left');}
 }
}else if(step==='C2-roles'){assert.equal(model.parts.length,before.parts.length);assert.equal(differences.length,0);}
else if(step==='D'){
 const gear=before.parts.find(p=>p.id==='CAM-010'),changed=model.parts.find(p=>p.id===gear.id);
 for(const mode of ['play','ff','rew'])assert(Math.abs(changed.spin[mode].rate/gear.spin[mode].rate-1.5)<.0001,'Gear rate did not scale by 1.5');
 const motion=await json('build/exports/motion.json'),old=await read(baseline,'rebuild/build/exports/motion.json');
 assert(Math.abs(motion.controls['volume-left'].travelMm/old.controls['volume-left'].travelMm-1.25)<.00001);
 for(const id of ['volume-right','tone','hotline'])assert.deepEqual(motion.controls[id],old.controls[id],id+': unrelated control changed');
 const low=controlVisualOffset('CTL-05',{volumeLeft:0,view:'assembled'}),high=controlVisualOffset('CTL-05',{volumeLeft:1,view:'assembled'}),travel=Math.hypot(...high.map((v,i)=>v-low[i]));
 assert(Math.abs(travel-motion.controls['volume-left'].travelMm)<.00002,'Native travel did not reach the viewer module');
 differences.push({nativeGearRateFactor:1.5,nativeLeftVolumeFactor:1.25,viewerControlTravelMm:travel});
}else throw Error('This verifier expects a successful B, C1, C2-roles or D build. Invalid-ID steps must fail before an export.');
const report={status:'PASS',step,scope:'Export/module verification; actual browser pointer checks remain separate.',nativeSHA256:model.source_sha256,unchangedBaselineOwners:unchanged,differences,reservedAbsentIds:inventory.missing_owner_ids_reserved};
await mkdir(path.join(KIT,'acceptance-results'),{recursive:true});await writeFile(path.join(KIT,'acceptance-results',step+'-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
