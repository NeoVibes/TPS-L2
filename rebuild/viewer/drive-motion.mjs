// Angles belong to the pulleys. Belts have no separate clock or FF multiplier.
export const wrapDistance=(distance,length)=>((distance%length)+length)%length;
export function beltTravel(belt,driverAngle) {
 return wrapDistance(driverAngle*belt.mmPerDriverRadian,belt.loopLengthMm);
}
export function canAdvancePart(part,state) {
 return !state.paused&&(!part.is_cassette||state.media==='loaded')&&state.explode===0&&state.radial===0&&
  !['exploded','catalog'].includes(state.view)&&(state.displayExplosion??0)===0&&(state.displayRadial??0)===0&&
  !(state.view==='service'&&(part.rest_when_separated||part.is_cassette));
}
export function advancePartAngle(angle,part,spin,state,seconds) {
 return spin&&canAdvancePart(part,state)?angle+spin.rate*seconds*state.speed:angle;
}
export function stripeCoverage(distance,travel,length,width,antialias=.02) {
 const d=Math.abs(wrapDistance(distance-travel+length/2,length)-length/2);
 const a=Math.min(width/2,Math.max(.0001,antialias));
 const t=Math.max(0,Math.min(1,(d-width/2+a)/(2*a)));
 return 1-t*t*(3-2*t);
}
