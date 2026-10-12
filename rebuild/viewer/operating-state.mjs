import config from '../config/model.json' with {type:'json'};
// Shared exhibit transport state. Presentation (views, sections and separation)
// deliberately lives elsewhere. These interlocks describe this demonstration,
// not a newly verified claim about the TPS-L2's concealed mechanism.
export const OPERATING_POLICY=Object.freeze(config.viewer.operatingPolicy);
export const TRANSPORT_RATES=Object.freeze({stop:0,play:1,ff:OPERATING_POLICY.fastWindRatio,rew:-OPERATING_POLICY.fastWindRatio});
const clamp = (value, min, max, fallback = min) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
const defaults = () => ({
  mode: 'stop', door: false, batteryOpen: false, media: 'loaded', paused: false, speed: config.viewer.defaultSpeed,
  tapePosition: 0, tapeDuration: OPERATING_POLICY.tapeDurationSeconds, tapeRevision: 0,
  volumeLeft: .5, volumeRight: .5, toneTouched: false, tone: 'high', hotline: false,
  audioEnabled: false, muted: false,
  stopCycle: null, stopTravel: 0, ejectNeedsOpenCover: false,
});

// Timing and the existing 1 mm stroke are illustrative. Sony's user sequence
// establishes release first, then a separate eject press with the lid open.
export const STOP_CYCLE = Object.freeze(config.viewer.stopCycle);
export function transportInterval(state, seconds) {
  if (state.paused || !canTransportRun(state)) return {mode: state.mode, seconds: 0};
  const cycle = state.stopCycle;
  const available = cycle?.kind === 'stop' && !cycle.committed
    ? Math.max(0, (STOP_CYCLE.press - cycle.elapsed) / state.speed) : seconds;
  return {mode: state.mode, seconds: Math.min(seconds, available)};
}
export function cancelStopCycle(state) { state.stopCycle = null; state.stopTravel = 0; }

function normalize(state) {
  state.mode = Object.hasOwn(TRANSPORT_RATES, state.mode) ? state.mode : 'stop';
  state.door = Boolean(state.door);
  state.batteryOpen = Boolean(state.batteryOpen);
  state.media = ['loaded', 'ejected', 'removed'].includes(state.media) ? state.media : 'loaded';
  state.paused = Boolean(state.paused);
  state.speed = clamp(state.speed, ...config.viewer.speedRange, config.viewer.defaultSpeed);
  state.tapePosition = clamp(state.tapePosition, 0, 1);
  state.tapeDuration = clamp(state.tapeDuration, 1, 86400, OPERATING_POLICY.tapeDurationSeconds);
  state.tapeRevision = Math.max(0, Math.floor(Number(state.tapeRevision) || 0));
  state.volumeLeft = clamp(state.volumeLeft, 0, 1, .5);
  state.volumeRight = clamp(state.volumeRight, 0, 1, .5);
  state.tone = state.tone === 'low' ? 'low' : 'high';
  for (const key of ['hotline', 'audioEnabled', 'muted', 'toneTouched']) state[key] = Boolean(state[key]);
  return state;
}

export function createOperatingState(initial = {}) {
  return normalize({ ...defaults(), ...initial });
}

export function resetOperating(state) {
  // Do not overwrite camera, tour, selection, or other presentation fields.
  return Object.assign(state, defaults());
}

export function canTransportRun(state) {
  return !['exploded', 'catalog'].includes(state.view) && !(state.explode > 0 || state.radial > 0);
}

export function isTapeMoving(state) {
  return canTransportRun(state) && state.media === 'loaded' && state.view !== 'service' && !state.paused && state.mode !== 'stop';
}

export function dispatchOperating(state, action) {
  switch (action?.type) {
    case 'transport':
      if (Object.hasOwn(TRANSPORT_RATES, action.mode) && (action.mode === 'stop' || canTransportRun(state))) {
        cancelStopCycle(state); state.ejectNeedsOpenCover = false;
        state.mode = action.mode;
        state.paused = false;
      }
      break;
    case 'stop-eject':
      if (!canTransportRun(state) || state.stopCycle) break;
      state.stopCycle = {kind: state.mode === 'stop' ? 'eject' : 'stop', elapsed: 0, committed: false};
      state.stopTravel = 0; state.ejectNeedsOpenCover = false;
      state.paused = false;
      state.hotline = false;
      break;
    case 'door':
      state.ejectNeedsOpenCover = false;
      state.door = action.open === undefined ? !state.door : Boolean(action.open);
      if (!state.door && state.media === 'ejected') state.media = 'loaded';
      break;
    case 'cassette':
      if (state.door) {
        state.media = (action.inserted === undefined ? state.media === 'removed' : action.inserted) ? 'loaded' : 'removed';
      }
      break;
    case 'battery-door':
    case 'battery-latch':
      state.batteryOpen = action.open === undefined ? !state.batteryOpen : Boolean(action.open);
      break;
    case 'pause': state.paused = action.paused === undefined ? !state.paused : Boolean(action.paused); break;
    case 'seek':
      state.tapePosition = clamp(action.position, 0, 1, state.tapePosition);
      state.tapeRevision += 1;
      break;
    case 'speed': state.speed = clamp(action.value, ...config.viewer.speedRange, state.speed); break;
    case 'volume':
      if (action.channel === 'left' || action.channel === 'right') state[action.channel === 'left' ? 'volumeLeft' : 'volumeRight'] = clamp(action.value, 0, 1);
      break;
    case 'tone': state.toneTouched = true; state.tone = action.value === 'low' ? 'low' : 'high'; break;
    case 'hotline': state.hotline = action.active === undefined ? !state.hotline : Boolean(action.active); break;
    case 'audio-enable': state.audioEnabled = action.enabled === undefined ? !state.audioEnabled : Boolean(action.enabled); break;
    case 'mute': state.muted = action.muted === undefined ? !state.muted : Boolean(action.muted); break;
    case 'reset': return resetOperating(state);
    default: break;
  }
  return normalize(state);
}

export function advanceOperating(state, dt) {
  const seconds = Number(dt);
  if (!Number.isFinite(seconds) || seconds <= 0) return state;
  const interval = transportInterval(state, seconds);
  if (isTapeMoving(state)) {
    const rate = TRANSPORT_RATES[state.mode] * state.speed;
    const next = state.tapePosition + interval.seconds * rate / state.tapeDuration;
    state.tapePosition = Math.max(0, Math.min(1, next));
    if ((rate > 0 && next >= 1 - 1e-12) || (rate < 0 && next <= 1e-12)) {
      state.tapePosition = rate > 0 ? 1 : 0;
      state.mode = 'stop'; state.hotline = false;
    }
  }
  if (!canTransportRun(state)) cancelStopCycle(state);
  const cycle = state.stopCycle;
  if (cycle && !state.paused) {
    cycle.elapsed += seconds * state.speed;
    if (!cycle.committed && cycle.elapsed >= STOP_CYCLE.press - 1e-12) {
      if (cycle.kind === 'stop') state.mode = 'stop';
      else if (state.door && state.media === 'loaded') state.media = 'ejected';
      else if (!state.door && state.media !== 'removed') state.ejectNeedsOpenCover = true;
      cycle.committed = true;
    }
    const {press,hold,release} = STOP_CYCLE, t = cycle.elapsed;
    const linear = t < press ? t / press : t < press + hold ? 1 : Math.max(0, 1 - (t-press-hold)/release);
    state.stopTravel = linear*linear*(3-2*linear);
    if (t >= press+hold+release-1e-12) cancelStopCycle(state);
  }
  return state;
}
