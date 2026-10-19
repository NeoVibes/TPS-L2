import './test_setup.mjs';
import assert from 'node:assert/strict';
import {parseServiceCatalog} from '../viewer/service-catalog.mjs';
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {partSearchText,copyTarget,assemblySearchEntries,serviceSearchEntries,serviceEntriesForPart,serviceFields,validateServiceCatalog} from '../viewer/part-information.mjs';
const release=JSON.parse(readFileSync('config/release.json'));
const model=globalThis.portableTapePlayerData.model.meta;
assert.deepEqual(model.fictional_serial,{value:'12345',fictional:true,part_id:'BAT-001'});
const count=(text,needle)=>text.split(needle).length-1;
for(const file of ['../README.md','../view/index.html']){
 const text=readFileSync(file,'utf8');
 assert.equal(count(text,release.statement),1,file+': one statement of what the model is');
 assert.equal(count(text,release.serialNotice),1,file+': one fictional serial notice');
 assert(!/component-evidence|id="partEvidence"|id="partNote"|id="evidenceDetails"|Historical research observation/.test(text),file+': removed notes must not be embedded');
}
assert(!existsSync('notes/public-notes.json'));assert(!existsSync('viewer/public-notes.mjs'));
for(const part of model.parts){const text=partSearchText(part);assert(text.includes(part.id));assert(text.includes(part.name));}
assert.equal(partSearchText({id:'NEW-001',name:'New detail',group:'Ungrouped'}),'NEW-001 New detail Ungrouped');
for(const url of ['file:///example/model.html?private=1#part=OLD','http://127.0.0.1:8784/model/?private=1','http://localhost/','http://[::1]/','http://preview.localhost/']){
 assert.deepEqual(copyTarget('BAT-001',new URL(url)),{kind:'id',label:'Copy part ID',text:'BAT-001'});
}
assert.deepEqual(copyTarget('BAT-001',new URL('https://example.org/model/?private=1#old')),{kind:'link',label:'Copy part link',text:'https://example.org/model/#part=BAT-001'});
const app=readdirSync('viewer').filter(f=>/^app/.test(f)).map(f=>readFileSync('viewer/'+f,'utf8')).join('\n'),template=readFileSync('viewer/page.html','utf8');
assert(!app.includes('writeText(location.href)'));assert(!app.includes('Copy the address bar'));
assert(app.includes('$("copyFallback").select()'));assert(template.includes('id="copyFallback" readonly'));
assert(!/\n\s+push:/.test(readFileSync('../publish/github/pages.yml','utf8')));
assert(readFileSync('../publish/github/pages.yml','utf8').includes('workflow_dispatch:'));
writeFileSync('build/test-results/evidence-tests.json',JSON.stringify({passed:true,scope:'Global release statements, fictional serial, component search, private-address-safe copied IDs and manual deployment trigger; replaces removed per-part notes coverage.',parts:model.parts.length,offlineBrowserAcceptance:false},null,2)+'\n');
console.log('PUBLIC INFORMATION PASS');

const config=JSON.parse(readFileSync('config/model.json','utf8'));
for(const query of ['motor','MNF-1600B','M1','8-835-008-11'])assert.equal(assemblySearchEntries(config.inspectionContexts,query)[0][0],'motorAssembly');
const motor=config.inspectionContexts.motorAssembly;assert.equal(motor.partIds.length,31);assert.equal(new Set(motor.partIds).size,31);for(const id of motor.partIds)assert(model.parts.some(p=>p.id===id));assert(!motor.partIds.includes('MTR-006'));assert(!motor.partIds.includes('MTR-050'));
const catalog=parseServiceCatalog(readFileSync('../edit/service-manual-parts.csv','utf8')),registry=JSON.parse(readFileSync('config/part-ids.json','utf8')).records.map(r=>r.id);
validateServiceCatalog(catalog,registry);
const motorEntry=serviceSearchEntries(catalog,'8-835-008-11');assert.equal(motorEntry.length,1);assert.equal(motorEntry[0].refNo,'M1');assert.equal(motorEntry[0].schematicRefNo,'M901');assert.deepEqual(motorEntry[0].partIds.slice().sort(),motor.partIds.slice().sort());
assert.deepEqual(serviceSearchEntries(catalog,'M901'),motorEntry);
const stopEntry=serviceSearchEntries(catalog,'3-568-726-00');assert.equal(stopEntry.length,1);assert.equal(stopEntry[0].refNo,null);assert.deepEqual(stopEntry[0].partIds,['CTL-04']);assert.deepEqual(serviceFields(stopEntry[0]).slice(0,3),[['Ref. No.','Not listed'],['Part No.','3-568-726-00'],['Description','Button, STOP/EJECT']]);
assert.equal(serviceSearchEntries(catalog,'1-552-849-00')[0].partIds.length,10);assert(!serviceSearchEntries(catalog,'1-552-849-00')[0].partIds.includes('CTL-08'));
assert.equal(serviceSearchEntries(catalog,'1-553-086-00')[0].partIds.length,11);
assert.equal(serviceSearchEntries(catalog,'3-480-135-00').length,0);assert(serviceSearchEntries(catalog,'3-480-136-00').some(e=>e.partIds.includes('BLT-001')));
assert(catalog.some(e=>e.refNo==='C102'&&e.variant==='former'&&!e.partIds.length));assert(catalog.some(e=>e.refNo==='C102'&&e.variant==='new'&&e.partIds.includes('CAP-102')));
assert(serviceEntriesForPart(catalog,'MTR-031').includes(motorEntry[0]));assert.equal(serviceEntriesForPart(catalog,'PRT-000001').length,0);
assert.throws(()=>validateServiceCatalog([...catalog,catalog[0]],registry),/duplicate service catalog ID/);
assert.throws(()=>validateServiceCatalog([{...catalog[0],partIds:['UNKNOWN-001']}],registry),/unissued model ID/);
assert(template.includes('id="partService"'));assert(!app.includes('assemblySearchEntries('));
writeFileSync('build/test-results/service-catalog-tests.json',JSON.stringify({passed:true,entries:catalog.length,mappedEntries:catalog.filter(e=>e.partIds.length).length,unmappedEntries:catalog.filter(e=>!e.partIds.length).length,modelParts:new Set(catalog.flatMap(e=>e.partIds)).size,scope:'Separate service/model identities, assembly membership, variant separation, corrected ordering number, stable ID lookup and invalid mappings rejected'},null,2)+'\n');
console.log('SERVICE CATALOG PASS');

// Unequal synthetic measurements prove source identity, including combined exterior states.
const {resolvePartDetails, formatDimensions, formatPartDetails, detailPrecision} = await import('../viewer/part-information.mjs');
const exterior = {default:'later',versions:['later','intermediate','early']};
const shared = {id:'SHARED',name:'SHARED • Shared',meshes:[{}]};
const baseCombined = {id:'BASE',name:'Base',meshes:[{}, {versions:['later','intermediate']}]};
const altCombined = {id:'ALT',name:'Alternate',meshes:[{}, {versions:['later']}]};
const cassette = {id:'TAPE',name:'TAPE • Cassette',is_cassette:true,meshes:[{}]};
const meta = {exterior,alternatives:{cassette:{parts:[cassette]}}};
const rec = (n) => ({size_mm:[n + .111,n + 10.222,n + 20.333]});
const measured = {parts:{SHARED:rec(11),BASE:rec(41),ALT:rec(71),TAPE:rec(101)},
 exterior:{early:{BASE:rec(131),ALT:rec(999)},intermediate:{BASE:rec(999),ALT:rec(161)}},cassette_detailed:{TAPE:rec(191)}};
const rows = [['SHARED',''],['BASE','later+intermediate'],['BASE','early'],['ALT','later'],['ALT','intermediate+early'],['TAPE','original'],['TAPE','detailed']].map(([part_id,variant],i)=>({part_id,variant,confirmation_level:String(i)}));
const levels = rows.map((r,i)=>'Meaning '+i);
for(const [part,version,choice,record,variant] of [
 ...exterior.versions.map(v=>[shared,v,'original',measured.parts.SHARED,'']),
 [baseCombined,'intermediate','original',measured.parts.BASE,'later+intermediate'],
 [baseCombined,'early','original',measured.exterior.early.BASE,'early'],
 [altCombined,'early','original',measured.exterior.intermediate.ALT,'intermediate+early'],
 [cassette,'early','original',measured.parts.TAPE,'original'],
 [cassette,'later','refined',measured.cassette_detailed.TAPE,'detailed'],
 [cassette,'early','detailed',measured.cassette_detailed.TAPE,'detailed'],
 [shared,'unsupported','bad',measured.parts.SHARED,'']
]) {
 const details = resolvePartDetails({part,meta,measured,rows,levels,exterior:version,cassette:choice});
 assert.equal(details.record,record); assert.equal(details.variant,variant);
 assert.equal(details.confirmation,rows.find(r=>r.part_id===part.id&&r.variant===variant));
 assert.deepEqual(details.dimensions,[record.size_mm[0],record.size_mm[2],record.size_mm[1]]);
 assert.equal(formatDimensions(details),`X ${record.size_mm[0].toFixed(1)} × Y ${record.size_mm[2].toFixed(1)} × Z ${record.size_mm[1].toFixed(1)} mm`);
 assert(detailPrecision(details).includes(String(record.size_mm[0])));
 const text=formatPartDetails(details,[],copyTarget(part.id,new URL('https://example.org/demo/?private=1')));
 assert(text.includes('Service mapping: Unknown'));assert(text.includes('stopped model, lid closed, cassette seated'));
 assert(!text.includes('private=1'));if(part.is_cassette)assert(text.includes('does not restore cassette choice'));
}
for(const bad of [undefined,{}, {size_mm:[1,2]}, {size_mm:[1,'2',3]}, {size_mm:[NaN,2,3]}, {size_mm:[-1,2,3]}]) {
 const source={...measured,exterior:{intermediate:{ALT:bad}}};
 const d=resolvePartDetails({part:altCombined,meta,measured:source,rows,levels,exterior:'early',cassette:'original'});
 assert.equal(d.record,bad);assert.equal(d.dimensions,null);assert.equal(d.confirmation,rows[4]);assert.equal(formatDimensions(d),'Dimensions unavailable');
}
const real = portableTapePlayerData.model;
const {parseMasterList}=await import('../viewer/app-master-list.mjs');
const realRows=parseMasterList(readFileSync('../view/master-parts.csv','utf8'));
for(const id of ['BLT-001','EXT-030','MEDIA-001'])for(const version of exterior.versions)for(const choice of ['original','refined']) {
 const part=real.meta.parts.find(p=>p.id===id);
 const d=resolvePartDetails({part,meta:real.meta,measured:real.measured,rows:realRows,exterior:version,cassette:choice});
 assert(d.dimensions);assert(d.confirmation);
 if(id==='BLT-001')assert.equal(formatDimensions(d),'X 66.7 × Y 19.3 × Z 4.5 mm');
}
console.log('Selected measurement sources, confirmation identity, precision, missing records and real integration pass');

const {partExplanations}=await import('../viewer/part-information.mjs');
assert.deepEqual(Object.keys(partExplanations),['MTR-001','MEC-011','BAY-052','BAY-061','BAY-060']);
for(const id of Object.keys(partExplanations)) assert(model.parts.some(p=>p.id===id));
assert.equal((template.match(/class="photo-request"/g)||[]).length,4);
for(const id of [...template.matchAll(/\b(?:EXT|BAY|STP|MEDIA)-\d{3}\b/g)].map(m=>m[0]))assert(model.parts.some(p=>p.id===id),'Photo request ID '+id);
