import config from '../config/model.json' with {type:'json'};
import { TRANSPORT_RATES } from './operating-state.mjs';
import { reelTurns } from './tape.mjs';

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
// crossings land on the same tape position and component rotations. Mode seconds
// are unscaled; the tape position and the reels' angles (radians, for the parts
// and for the cassette's own) are worked out at the motion speed given.
export function tourMotion(seconds, steps, speed=1) {
 const duration=steps.reduce((sum,step)=>sum+step.duration,0);
 const elapsed=Math.max(0,Math.min(duration,Number(seconds)||0));
 const modeSeconds={stop:0,play:0,ff:0,rew:0},mediaModeSeconds={...modeSeconds};
 const angles=()=>Object.fromEntries(Object.keys(modeSeconds).map(m=>[m,{supply:0,takeup:0}]));
 const reelAngle=angles(),mediaReelAngle=angles();
 let remaining=elapsed,tapePosition=0;
 for(const step of steps) {
  const time=Math.min(remaining,step.duration);
  if(time<=0)break;
  const available=!['exploded','catalog'].includes(step.view);
  const mode=available&&Object.hasOwn(TRANSPORT_RATES,step.mode)?step.mode:'stop';
  modeSeconds[mode]+=time;
  // Cassette meshes are moved out of the transport in the service view. The
  // mechanism keeps running but those display-only media meshes remain still.
  const loaded=!step.media||step.media==='loaded',moving=step.view!=='service'&&loaded;
  if(moving)mediaModeSeconds[mode]+=time;
  const run=reelTurns(tapePosition,mode,time*speed,{moving,loaded});
  tapePosition=run.position;
  for(const side of ['supply','takeup']){reelAngle[mode][side]+=run.turned[side];if(moving)mediaReelAngle[mode][side]+=run.turned[side];}
  remaining-=time;
 }
 return {elapsed,modeSeconds,mediaModeSeconds,tapePosition,reelAngle,mediaReelAngle};
}
