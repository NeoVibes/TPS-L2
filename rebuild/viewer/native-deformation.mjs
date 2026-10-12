import config from '../config/model.json' with {type:'json'};
import {interpolateSamples} from './model-controls.mjs';
// Native shape-key displacements in owner coordinates. These are reconstructed
// spring paths; they do not simulate force, compliance or contact pressure.
const clamp = value => Math.max(0, Math.min(1, value));
export function deformationWeights(deformation,{pose='stop',playTravel=0,tone='high',toneTouched=false,view='assembled',batteryRelease=0,stopTravel=0}={}){
 const disconnected=['exploded','catalog','service'].includes(view);
 return deformation.targets.map(target=>{
  let weight;const curve=target.controlCurve;
  if(curve){
   const values={tone:disconnected||!toneTouched?.5:tone==='low'?0:1,play:disconnected?0:clamp(playTravel),stop:['exploded','catalog'].includes(view)?0:clamp(stopTravel),battery:['exploded','catalog'].includes(view)?0:clamp(batteryRelease)};
   if(!(curve.channel in values))throw Error('Unknown native control curve '+curve.channel);
   weight=interpolateSamples(curve.samples,values[curve.channel],'weight');
  }else if(deformation.owner===config.deformation.channels.transport)weight=target.weights[disconnected?'stop':pose];
  else throw Error('Missing native deformation curve for '+deformation.owner);
  if(!Number.isFinite(weight))throw Error('Missing native deformation weight for '+deformation.owner+'/'+target.name);
  return weight-target.initial;
 });
}
export function applyDeformationPositions(base, targets, weights, output = new Float32Array(base.length)) {
  if (targets.length !== weights.length || targets.some(t => t.positions.length !== base.length)) throw new Error('Native deformation topology mismatch');
  for (let i = 0; i < base.length; i++) {
    let value = base[i];
    for (let j = 0; j < weights.length; j++) value += targets[j].positions[i] * weights[j];
    output[i] = value;
  }
  return output;
}
