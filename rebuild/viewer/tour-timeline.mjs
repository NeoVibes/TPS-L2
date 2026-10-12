import config from '../config/model.json' with {type:'json'};
import { TRANSPORT_RATES } from './operating-state.mjs';

export const TOUR_DURATIONS = config.viewer.tourSteps.map(step=>step.duration);
export const TOUR_SECONDS = TOUR_DURATIONS.reduce((a,b)=>a+b,0);
export function tourLocation(seconds) {
 let time=Math.max(0,Math.min(TOUR_SECONDS,Number(seconds)||0));
 for(let index=0;index<TOUR_DURATIONS.length;index++) {
  if(time<TOUR_DURATIONS[index]||index===TOUR_DURATIONS.length-1)return {index,offset:time,ended:seconds>=TOUR_SECONDS};
  time-=TOUR_DURATIONS[index];
 }
}

// Integrate from absolute tour time so seeking and low-frame-rate chapter
// crossings land on the same tape position and component rotations. Values are
// unscaled seconds; the viewer applies its selected speed exactly once.
export function tourMotion(seconds, steps) {
 const duration=steps.reduce((sum,step)=>sum+step.duration,0);
 const elapsed=Math.max(0,Math.min(duration,Number(seconds)||0));
 const modeSeconds={stop:0,play:0,ff:0,rew:0},mediaModeSeconds={...modeSeconds};
 let remaining=elapsed,tapeSeconds=0;
 for(const step of steps) {
  const time=Math.min(remaining,step.duration);
  if(time<=0)break;
  const available=!['exploded','catalog'].includes(step.view);
  const mode=available&&Object.hasOwn(TRANSPORT_RATES,step.mode)?step.mode:'stop';
  modeSeconds[mode]+=time;
  // Cassette meshes are moved out of the transport in the service view. The
  // mechanism keeps running but those display-only media meshes remain still.
  if(step.view!=='service'&&(!step.media||step.media==='loaded'))mediaModeSeconds[mode]+=time;
  if(step.view!=='service'&&(!step.media||step.media==='loaded'))tapeSeconds+=time*TRANSPORT_RATES[mode];
  remaining-=time;
 }
 return {elapsed,modeSeconds,mediaModeSeconds,tapeSeconds};
}
