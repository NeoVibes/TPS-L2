import config from '../config/model.json' with {type:'json'};
// Which parts turn, and what the shut-off lever does, in each transport mode.
// roles.tapeDragged lists, per mode, the reel side that only the tape turns: the supply side in PLAY and FF, the
// take-up side in REW. With no cassette seated nothing turns them. A stalled reel (automatic shut-off) and what
// turns with it stand still too.
const dragged = Object.fromEntries(Object.entries(config.roles.tapeDragged).map(([mode, ids]) => [mode, new Set(ids)]));
const reelDriven = new Set(config.roles.reelDriven);
export function spinStopped(id, mode, state) {
  return Boolean(state.autoStop) && reelDriven.has(id) || state.media !== 'loaded' && Boolean(dragged[mode]?.has(id));
}
// The shut-off lever rides the cam on the third gear whatever the mode: the gear turns in PLAY, FF and REW and keeps
// its angle in STOP, and the lever stands in the same place in all four. Detection and tripping belong to PLAY only,
// where a reel can stall.
export function shutOffStaged(role, mode) { return mode === 'play' || role === 'lever'; }
