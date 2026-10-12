import './test_setup.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {operationIndicatorOn,updateOperationIndicator} from '../viewer/operation-indicator.mjs';
import {createOperatingState,dispatchOperating,advanceOperating,resetOperating} from '../viewer/operating-state.mjs';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const model=read('build/exports/model.json'),packed=read('build/exports/model-packed.json'),viewer=read('build/viewer-data/model.json');
const specs=model.materials.filter(m=>m.operationIndicator);assert.equal(specs.length,1);const spec=specs[0].operationIndicator;
assert.equal(spec.owner,'EXT-061');assert.deepEqual(spec.modes,['play','ff','rew']);assert.equal(spec.strength,2);assert(spec.color[0]>.99&&spec.color[1]<.01);
for(const m of [packed,viewer])assert.deepEqual(m.materials.filter(m=>m.operationIndicator),specs);
for(const p of model.parts)for(const m of p.meshes)if(model.materials[m.m].operationIndicator)assert.equal(p.id,'EXT-061','Only resin of D901 emits red');
assert.equal(viewer.parts.find(p=>p.id==='EXT-061').package,'exterior');
const materials=[new T.MeshStandardMaterial(),new T.MeshStandardMaterial()];for(const m of materials)m.userData.operationIndicator=spec;
let cases=0;
for(const mode of ['stop','play','ff','rew'])for(const view of ['assembled','service','exploded','catalog'])for(const paused of [false,true])for(const media of ['loaded','removed'])for(const door of [false,true]){
 const state={...createOperatingState(),mode,view,paused,media,door};const expected=mode!=='stop'&&['assembled','service'].includes(view);
 assert.equal(operationIndicatorOn(state),expected);updateOperationIndicator(materials,state);for(const m of materials){assert.equal(m.emissiveIntensity,expected?2:0);assert.deepEqual(m.emissive.toArray(),spec.color);assert.deepEqual(m.color.toArray(),expected?spec.color.map(v=>v*.18):[1,1,1]);}cases++;
}
const state=createOperatingState();dispatchOperating(state,{type:'transport',mode:'play'});assert(operationIndicatorOn(state));dispatchOperating(state,{type:'stop-eject'});assert(operationIndicatorOn(state));advanceOperating(state,.05);assert(operationIndicatorOn(state));advanceOperating(state,1);assert(!operationIndicatorOn(state));
for(const k of ['explode','radial'])assert(!operationIndicatorOn({...state,mode:'play',[k]:.1}));
dispatchOperating(state,{type:'transport',mode:'rew'});resetOperating(state);assert(!operationIndicatorOn(state));
const paths=['viewer/operation-indicator.mjs','viewer/app.js','tools/export_model.py','tests/test_operation_indicator.mjs','build/viewer-data/model.json'];
fs.writeFileSync('build/test-results/operation-indicator-tests.json',JSON.stringify({passed:true,nativeSha256:model.source_sha256,cases,sourceHashes:Object.fromEntries(paths.map(p=>[p,sha(p)])),scope:'Emission metadata survives packing; native mesh and cap-clearance preservation are covered separately by the frozen geometry comparison; only D901 resin lights; PLAY/FF/REW, pause, STOP downstroke, reset, service, cassette absence, door and separation states.'},null,2)+'\n');console.log('OPERATION INDICATOR PASS',cases);
