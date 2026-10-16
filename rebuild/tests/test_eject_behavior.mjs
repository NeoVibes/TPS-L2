import './test_setup.mjs';
import assert from 'node:assert/strict';
import {createOperatingState,dispatchOperating,advanceOperating,resetOperating} from '../viewer/operating-state.mjs';
import {ejectTravel} from '../viewer/eject-motion.mjs';
let cases=0;
for(const view of ['assembled','service'])for(const speed of [.05,.55,1,2])for(const media of ['loaded','removed']){
 const s=createOperatingState({view,speed,media,door:true,mode:'play'});dispatchOperating(s,{type:'stop-eject'});advanceOperating(s,.09/speed);assert.equal(ejectTravel(s),0);advanceOperating(s,.6/speed);assert.equal(s.mode,'stop');assert.equal(ejectTravel(s),0);
 dispatchOperating(s,{type:'stop-eject'});advanceOperating(s,.09/speed);assert(Math.abs(ejectTravel(s)-.5)<1e-9);dispatchOperating(s,{type:'pause'});const before=JSON.stringify(s);advanceOperating(s,10);assert.equal(JSON.stringify(s),before);dispatchOperating(s,{type:'pause'});advanceOperating(s,.09/speed);assert.equal(ejectTravel(s),1);advanceOperating(s,.42/speed);assert.equal(ejectTravel(s),media==='loaded'?1:0);
 s.view='exploded';assert.equal(ejectTravel(s),0);s.view=view;assert.equal(ejectTravel(s),media==='loaded'?1:0);resetOperating(s);assert.equal(ejectTravel(s),0);cases++;
}
console.log('EJECT BEHAVIOR PASS',cases);
