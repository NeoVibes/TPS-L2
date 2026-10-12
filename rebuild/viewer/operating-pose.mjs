import config from '../config/model.json' with {type:'json'};
// Native export samples keep cassette handling and transport independent.
export function operatingPose(state) {
 if (['exploded','catalog'].includes(state.view)) return 'stop';
 const mode = state.mode;
 if (state.media === 'removed') return `${mode}_removed_${state.door ? 'open' : 'closed'}`;
 if (state.media === 'ejected' && state.door) return `${mode}_ejected`;
 if (state.door) return mode === 'stop' ? 'open' : `${mode}_open`;
 return mode;
}
export function modelControlsEnabled(state, display = {}) {
 return state.uiMode === 'operate' && ['assembled','service'].includes(state.view) &&
  (!state.contextIds||state.contextKey==='ejectMechanism') && !(state.explode > 0 || state.radial > 0) &&
  !(display.explosion > .001 || display.radial > .001);
}
// Catch clears before hinge movement, and returns only after the lid closes.
export function batterySequence(progress) {
 const p = Math.min(1, Math.max(0, progress));
 return {release: Math.min(1,p/config.viewer.batteryReleasePhase), open: Math.max(0,(p-config.viewer.batteryReleasePhase)/(1-config.viewer.batteryReleasePhase))};
}
