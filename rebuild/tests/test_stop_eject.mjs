import './test_setup.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createOperatingState,dispatchOperating,advanceOperating,transportInterval,resetOperating} from '../viewer/operating-state.mjs';
const act=(s,type,extra={})=>dispatchOperating(s,{type,...extra});
let cases=0;
for(const mode of ['play','ff','rew'])for(const speed of [.05,.55,1])for(const view of ['assembled','service']){
 const s=createOperatingState({mode,speed,view,explode:0,radial:0,tapePosition:.5});act(s,'stop-eject');
 advanceOperating(s,.09/speed);assert.equal(s.mode,mode);assert(Math.abs(s.stopTravel-.5)<1e-9);
 const cycle=s.stopCycle;act(s,'stop-eject');assert.equal(s.stopCycle,cycle,'Second click during the same stroke cannot eject');
 act(s,'pause');const frozen=JSON.stringify(s);advanceOperating(s,10);assert.equal(JSON.stringify(s),frozen);act(s,'pause');
 const boundary=transportInterval(s,1/speed);assert(Math.abs(boundary.seconds-.09/speed)<1e-9);assert.equal(boundary.mode,mode);
 advanceOperating(s,.09/speed);assert.equal(s.mode,'stop');assert.equal(s.stopTravel,1);assert.equal(s.media,'loaded');assert.equal(s.door,false);
 advanceOperating(s,.42/speed);assert.equal(s.stopCycle,null);assert.equal(s.stopTravel,0);
 act(s,'stop-eject');advanceOperating(s,1/speed);assert.equal(s.ejectNeedsOpenCover,true);assert.equal(s.door,false);assert.equal(s.media,'loaded');
 act(s,'door');act(s,'stop-eject');advanceOperating(s,.18/speed);assert.equal(s.media,'ejected');advanceOperating(s,.42/speed);assert.equal(s.stopTravel,0);
 act(s,'cassette');assert.equal(s.media,'removed');act(s,'stop-eject');advanceOperating(s,2/speed);assert.equal(s.media,'removed');
 act(s,'stop-eject');resetOperating(s);assert.equal(s.stopCycle,null);assert.equal(s.stopTravel,0);cases++;
}
const a=createOperatingState({mode:'play',speed:1,tapePosition:.5}),b=createOperatingState({mode:'play',speed:1,tapePosition:.5});act(a,'stop-eject');act(b,'stop-eject');for(let i=0;i<60;i++)advanceOperating(a,.01);advanceOperating(b,.6);assert(Math.abs(a.tapePosition-b.tapePosition)<1e-12);assert.equal(a.mode,b.mode);
for(const view of ['exploded','catalog']){const s=createOperatingState({view});act(s,'stop-eject');assert.equal(s.stopCycle,null);}
const paths=['viewer/app.js','viewer/operating-state.mjs','viewer/native-deformation.mjs','tests/test_stop_eject.mjs'];
fs.writeFileSync('build/test-results/stop-eject-tests.json',JSON.stringify({passed:true,cases,sourceHashes:Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),scope:'Blender-free behavior: press-before-disengage; release stroke; separate eject with manual lid opening; repeated clicks; pause; reset; speed/frame independence; separation.'},null,2)+'\n');console.log('STOP/EJECT PASS',cases);
