// Controls on the current native export. Travel follows inherited reconstruction
// drivers; it is illustrative and does not certify hidden fits or switch contacts.
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
import config from '../config/model.json' with {type:'json'};
import {optionalModelData} from './data.mjs';
const motionData=optionalModelData()?.motion || {controls:{},active_owner_ids:[]};   // control ranges and moving parts, sampled from the Blender file by the build
const nativeControls=motionData.controls;
const activeOwners=new Set(motionData.active_owner_ids);
const descriptors=config.controls.map(c=>({...c,partIds:c.partIds.filter(id=>activeOwners.has(id)),...(c.motionPartIds?{motionPartIds:c.motionPartIds.filter(id=>activeOwners.has(id))}:{}),...(nativeControls[c.id]?{axis:nativeControls[c.id].axis,travelMm:nativeControls[c.id].travelMm,restValue:nativeControls[c.id].restValue}:{} )}));
export const MODEL_CONTROLS = freeze(descriptors);
export const CONTROL_BINDINGS = freeze(Object.fromEntries(descriptors.flatMap(control => control.partIds.map(id => [id, control]))));
const byName = new Map(descriptors.map(control => [control.id, control]));
const clamp01 = (value, fallback = .5) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;

export function controlForPart(partId) { return CONTROL_BINDINGS[partId] || null; }
function resolve(id) { return controlForPart(id) || byName.get(id) || null; }

// Explicit phases keep a cancelled/lost gesture from leaving Hot Line latched.
// Presentation actions are handled by the viewer, not the transport reducer.
export function actionForControl(id, state = {}, phase = 'click', value) {
  const control = resolve(id);
  if (!control) return null;
  if (control.kind === 'momentary') {
    if (phase === 'press') return { type: 'hotline', active: true };
    if (['release', 'cancel', 'blur', 'hidden'].includes(phase)) return { type: 'hotline', active: false };
    return null;
  }
  if (phase === 'drag' || phase === 'set') {
    if (!Number.isFinite(value)) return null;
    if (control.kind === 'slider') return { type: 'volume', channel: control.channel, value: clamp01(value) };
    if (control.id === 'tone') return { type: 'tone', value: value >= .5 ? 'high' : 'low' };
    return null;
  }
  if (phase !== 'click') return null;
  if (control.mode) return { type: 'transport', mode: control.mode };
  if (control.id === 'tone') return { type: 'tone', value: state.tone === 'low' ? 'high' : 'low' };
  if (control.kind === 'slider') return null;
  return { type: control.id };
}

export function controlValue(id, state = {}) {
  const control = resolve(id);
  if (control?.kind === 'slider') return clamp01(state[control.stateKey]);
  if (control?.id === 'tone') return state.tone === 'low' ? 0 : 1;
  if (control?.id === 'hotline') return state.hotline ? 1 : 0;
  return 0;
}

// Apply to the full owner root after its native pose. Both volume materials
// belong to the grip: material 39 is the grip, 40 its long molded underside.
// The fixed scale (GRL-717) and TONE plate (EXT-050) must remain stationary.
// Transport caps and cover hinges already have native poses, so return zero.
export function interpolateSamples(samples,value,field){
 const v=Math.max(0,Math.min(1,value));let a=samples[0],b=samples.at(-1);
 for(let i=1;i<samples.length;i++)if(v<=samples[i].value){a=samples[i-1];b=samples[i];break;}
 const t=b.value===a.value?0:(v-a.value)/(b.value-a.value),av=a[field],bv=b[field];
 return Array.isArray(av)?av.map((x,i)=>x+(bv[i]-x)*t):av+(bv-av)*t;
}
export function controlVisualOffset(partId,state={}){
 if(state.view==='service'&&config.roles.serviceStaticControls.includes(partId))return [0,0,0];
 const control=descriptors.find(c=>c.motionPartIds?.includes(partId));
 if(!control)return [0,0,0];
 const native=nativeControls[control.id],track=native?.parts[partId];
 if(!track)throw Error('Missing native control samples for '+partId);
 const value=control.id==='tone'&&state.toneTouched===false?native.restValue:controlValue(control.id,state);
 return interpolateSamples(track.samples,value,'position').map((x,i)=>x-track.restPosition[i]);
}

// axisStart/End are screen positions for the complete low-to-high model travel.
// Projecting that model axis keeps drag direction correct after camera rotation.
// A nearly end-on axis deliberately does not change the value; HTML sliders are
// still usable. Consumers should capture a stable axis at pointer-down.
export function projectedDragValue({ startValue, start, current, axisStart, axisEnd, minimumAxisPixels = 4 } = {}) {
  const initial = clamp01(startValue);
  if (![start, current, axisStart, axisEnd].every(p => p?.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return initial;
  const dx = axisEnd[0] - axisStart[0], dy = axisEnd[1] - axisStart[1], lengthSquared = dx * dx + dy * dy;
  const threshold = Number.isFinite(minimumAxisPixels) ? Math.max(1e-6, minimumAxisPixels) : 4;
  if (lengthSquared < threshold * threshold) return initial;
  return clamp01(initial + ((current[0] - start[0]) * dx + (current[1] - start[1]) * dy) / lengthSquared, initial);
}

export function partIdForHit(hit) {
  if (hit?.partId) return hit.partId;
  for (let object = hit?.object; object; object = object.parent) {
    const id = object.userData?.part?.data?.id || object.userData?.partId;
    if (id) return id;
  }
  return null;
}
export function hitHierarchyVisible(hit) {
  for (let object = hit?.object; object; object = object.parent) if (object.visible === false) return false;
  return true;
}

// Pass ALL scene hits, not only control hits, to preserve surface occlusion.
// The renderer owns clipping and can exclude clipped intersections via acceptsHit.
// A non-control nearest surface blocks controls behind it, including the cassette
// beneath its transparent lid. Open the lid before interacting with the cassette.
export function pickModelControl(hits, { acceptsHit = () => true, getPartId = partIdForHit, allowsControl = () => true } = {}) {
  const visibleHits = (hits || []).filter(hit => Number.isFinite(hit.distance) && hit.distance >= 0 && hitHierarchyVisible(hit) && acceptsHit(hit)).sort((a, b) => a.distance - b.distance);
  const hit = visibleHits[0];
  if (!hit) return null;
  const partId = getPartId(hit), control = controlForPart(partId);
  return control && allowsControl(control, hit) ? { control, partId, hit } : null;
}
