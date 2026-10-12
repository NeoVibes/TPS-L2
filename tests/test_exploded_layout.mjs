import './test_setup.mjs';
import {assertInventoryCoverage} from './inventory_contract.mjs';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createExplodedLayout,explodedOffset} from '../viewer/exploded-layout.mjs';

const model=JSON.parse(await readFile('build/viewer-data/model.json'));
const {ownerIds}=assertInventoryCoverage(model);
const before=JSON.stringify(model),start=performance.now(),layout=createExplodedLayout(model.parts),durationMs=performance.now()-start;
const byId=new Map(model.parts.map(part=>[part.id,part])),groups=new Map(layout.groups.map(group=>[group.id,group]));
assert.equal(JSON.stringify(model),before,'No original transforms, geometry ranges or evidence metadata may change');
assert.deepEqual(Object.keys(layout.offsets).sort(),ownerIds);
assert.deepEqual(layout.groups.flatMap(group=>group.partIds).sort(),ownerIds);
assert.deepEqual(createExplodedLayout([...model.parts].reverse()),layout,'Source inventory order must not affect the assembly');

// Mechanical relationships chosen independently of the layout rules: populated
// boards, whole media and hardware that must stay with their actual parent.
const expectedRigidSets=[
 {name:'main/AF board population',ids:[...model.parts.filter(part=>part.group==='main/AF/volume board module').map(part=>part.id),...['CTL-05','CTL-06','VOL-041','VOL-051'].filter(id=>model.parts.some(part=>part.id===id))]},
 {name:'servo board population',ids:model.parts.filter(part=>part.group==='servo board module').map(part=>part.id)},
 {name:'jack board population',ids:model.parts.filter(part=>part.group==='jack board module').map(part=>part.id)},
 {name:'whole cassette',ids:['MEDIA-001','MEDIA-002','MEDIA-003','MEDIA-004','MEDIA-005','MEDIA-006']},
 {name:'lid glazing registration',ids:['EXT-030','EXT-031','EXT-032']},
 {name:'rear-owned battery catch and stationary hinge',ids:['EXT-010','BCL-010','BCL-020','BCL-030','HINGE-010']},
 {name:'battery door label',ids:['EXT-040','EXT-041']},
 {name:'cassette liner and mounting screws',ids:['BAY-010','BAY-040','BAY-041','BAY-042','BAY-043']},
 {name:'complete motor on its Y-axis',ids:model.parts.filter(part=>part.id.startsWith('MTR-')).map(part=>part.id)},
 {name:'battery case, contacts and retaining hardware',ids:model.parts.filter(part=>part.id.startsWith('BAT-')).map(part=>part.id)},
 {name:'tone plate and X-axis fasteners',ids:['EXT-050','SCR-T01','SCR-T02','SCR-T03']},
];
const displayedBounds=part=>part.correctedBounds||part.authoritativeBounds;
const midpoint=part=>displayedBounds(part).min.map((value,i)=>(value+displayedBounds(part).max[i])/2);
let rigidityPairsChecked=0,maximumRegistrationErrorMm=0,maximumDimensionErrorMm=0;
for(const set of expectedRigidSets){
 assert.ok(set.ids.length>1);
 const anchor=byId.get(set.ids[0]);assert.ok(anchor);
 for(const id of set.ids.slice(1)){
  const part=byId.get(id);assert.ok(part,id);
  for(const progress of [0,.05,.25,.5,.9,1]){
   const a=explodedOffset(layout,anchor.id,progress),b=explodedOffset(layout,id,progress);
   for(let axis=0;axis<3;axis++){
    const original=midpoint(part)[axis]-midpoint(anchor)[axis];
    const displayed=midpoint(part)[axis]+b[axis]-midpoint(anchor)[axis]-a[axis];
    maximumRegistrationErrorMm=Math.max(maximumRegistrationErrorMm,Math.abs(displayed-original));
   }
   assert.deepEqual(a,b,set.name+' must remain rigid throughout the transition');rigidityPairsChecked++;
  }
 }
}

// These Z-axis reel stacks cross cassette/deck/module boundaries. Original
// transverse registration must survive separation, not merely reset at zero.
const axialSets=[['MEDIA-003','MEDIA-004','BAY-031','BAY-021','DRV-100'],['MEDIA-005','MEDIA-006','BAY-030','BAY-020','DRV-104'],['BAY-010','BAY-052','HDC-001']];
let axialPairsChecked=0;
for(const ids of axialSets)for(const a of ids)for(const b of ids)for(const progress of [0,.25,.5,1]){
 const da=explodedOffset(layout,a,progress),db=explodedOffset(layout,b,progress);
 assert.equal(da[0]-db[0],0,'Coaxial registration must retain original X');
 assert.equal(da[1]-db[1],0,'Coaxial registration must retain original Y');axialPairsChecked++;
}
assert.deepEqual(layout.offsets['MEC-001'],[0,0,0],'Chassis is the fixed reassembly datum');
assert.deepEqual(layout.offsets['BAT-001'],[0,0,0],'Battery case remains with the core');
assert.notDeepEqual(layout.offsets['BCL-010'],layout.offsets['BAT-001'],'Catch follows rear cabinet, not the battery case');
assert.notDeepEqual(layout.offsets['BCL-010'],layout.offsets['EXT-040'],'Catch is not owned by the opening battery door');
const front=['liner','cassette','lid'].map(id=>groups.get(id));
const rear=['main-board','servo-board','jack-board','rear-cabinet','battery-door'].map(id=>groups.get(id));
let previous=groups.get('transport').bounds;
for(const group of front){assert.ok(group.bounds.min[2]-previous.max[2]>=28-1e-9,'Front module layers must be visibly separated');previous=group.bounds;}
previous=groups.get('transport').bounds;
for(const group of rear){assert.ok(previous.min[2]-group.bounds.max[2]>=28-1e-9,'Rear module layers must be visibly separated');previous=group.bounds;}

for(const part of model.parts){
 const offset=layout.offsets[part.id];assert.ok(offset.every(Number.isFinite));
 assert.ok(offset.filter(value=>value!==0).length<=1,'Every assembly moves on one principal axis');
 for(const amount of [0,.2,.5,.8,1,.8,.5,.2,0]){
  const delta=explodedOffset(layout,part.id,amount);
  if(amount===0)assert.deepEqual(delta,[0,0,0],'Reset is exactly original, including after reversal');
  for(let axis=0;axis<3;axis++){
   const bounds=displayedBounds(part),min=bounds.min[axis]+delta[axis],max=bounds.max[axis]+delta[axis];
   maximumDimensionErrorMm=Math.max(maximumDimensionErrorMm,Math.abs((max-min)-(bounds.max[axis]-bounds.min[axis])));
   assert.ok(min>=layout.bounds.min[axis]-1e-9&&max<=layout.bounds.max[axis]+1e-9,'Camera bounds enclose whole parts throughout the transition');
  }
 }
}
for(const group of layout.groups){
 assert.deepEqual(group.leader.from,group.anchor);
 assert.deepEqual(group.leader.to,group.anchor.map((value,i)=>value+group.offset[i]));
 assert.deepEqual(group.labelAnchor,group.leader.to);
 for(const id of group.partIds)assert.deepEqual(layout.offsets[id],group.offset,'One module has one rigid offset');
}
assert.ok(maximumRegistrationErrorMm<1e-9);assert.ok(maximumDimensionErrorMm<1e-9);
assert.throws(()=>createExplodedLayout([model.parts[0],model.parts[0]]),/Duplicate/);
assert.throws(()=>createExplodedLayout([{id:'NO-BOUNDS'}]),/bounds/);
assert.throws(()=>createExplodedLayout(model.parts,{gapMm:-1}),/Invalid/);
assert.deepEqual(createExplodedLayout([]).bounds.dimensions,[0,0,0]);
const sourceHashes={};
for(const path of ['viewer/exploded-layout.mjs','tests/test_exploded_layout.mjs','build/viewer-data/model.json'])sourceHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
const report={passed:true,nativeSha256:model.source_sha256,sourceHashes,parts:ownerIds.length,assemblies:layout.groups.length,rigidityPairsChecked,axialPairsChecked,maximumRegistrationErrorMm,maximumDimensionErrorMm,layoutMilliseconds:durationMs,bounds:layout.bounds,groups:layout.groups.map(group=>({id:group.id,name:group.name,parts:group.partIds.length,offset:group.offset})),scope:'Rigid display assemblies, source-axis registration, whole-part camera bounds, deterministic identity coverage and exact zero reset. No label-driven packing, collision-free removal, or factory sequence is claimed.'};
await writeFile('build/test-results/exploded-layout-tests.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
