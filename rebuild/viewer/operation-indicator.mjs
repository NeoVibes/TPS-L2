import {canTransportRun} from './operating-state.mjs';
// Pause freezes simulated time; it does not switch off an already powered motor.
export function operationIndicatorOn(state){
 return canTransportRun(state)&&['play','ff','rew'].includes(state.mode);
}
export function updateOperationIndicator(materials,state){
 const on=operationIndicatorOn(state);
 for(const material of materials){
  const spec=material.userData.operationIndicator;
  // Preserve the red signal color through the exhibit’s filmic tone mapping.
  material.toneMapped=false;
  material.emissive.setRGB(...spec.color);
  material.userData.indicatorUnlitColor??=material.color.toArray();
  material.color.setRGB(...(on?spec.color.map(v=>v*.18):material.userData.indicatorUnlitColor));
  material.emissiveIntensity=on?spec.strength:0;
 }
 return on;
}
