import config from '../config/model.json' with {type:'json'};
// One side of tape between the two hubs (config "tape"). Position p is the share of the tape on the take-up reel.
// A pack holding a share s has radius sqrt(empty² + s·(full² − empty²)), so the side is the area between an empty and
// a full pack over the tape's thickness, and it plays at the capstan's surface speed. Rates are in rad/s at motion
// speed 1; lengths in mm.
export const TAPE = Object.freeze(config.tape);
const E2 = TAPE.emptyPackRadiusMm ** 2, SPAN = TAPE.fullPackRadiusMm ** 2 - E2;
export const TAPE_LENGTH_MM = Math.PI * SPAN / TAPE.thicknessMm;
export const SIDE_SECONDS = TAPE_LENGTH_MM / TAPE.speedMmPerS;   // the side played through at speed 1
const clamp01 = v => Math.max(0, Math.min(1, v));
export const packRadius = share => Math.sqrt(E2 + clamp01(share) * SPAN);
export const packRadii = p => ({supply: packRadius(1 - p), takeup: packRadius(p)});
const shareAt = r => clamp01((r * r - E2) / SPAN);

// The drive's rates for the reel it turns while winding: the take-up reel in FF, the supply reel in REW. They are the
// spin rates exported for those reels' spindles (the same parts turn at the same rates in the native model).
export function windRates(spins) {
  const rate = (id, mode) => Math.abs(spins[id]?.[mode]?.rate ?? NaN);
  const r = {ff: rate(TAPE.reels.reference.takeup, 'ff'), rew: rate(TAPE.reels.reference.supply, 'rew')};
  if (!(r.ff > 0 && r.rew > 0)) throw Error('Reel spindles have no winding rates');
  return r;
}

/** The reels' turning rates (rad/s) in a mode at position p. Without tape, PLAY turns the take-up reel with its drum. */
export function reelRates(mode, p, {wind, drum, loaded = true}) {
  const {supply: rs, takeup: rt} = packRadii(p), v = TAPE.speedMmPerS;
  if (!loaded) return {play: {supply: 0, takeup: drum}, ff: {supply: 0, takeup: wind.ff}, rew: {supply: wind.rew, takeup: 0}}[mode] ?? {supply: 0, takeup: 0};
  if (mode === 'play') return {supply: v / rs, takeup: v / rt};
  if (mode === 'ff') return {supply: wind.ff * rt / rs, takeup: wind.ff};
  if (mode === 'rew') return {supply: wind.rew, takeup: wind.rew * rs / rt};
  return {supply: 0, takeup: 0};
}

/**
 * Moves the tape for `seconds` of motion (already scaled by the motion speed). Exact: in PLAY the position moves
 * steadily; while winding, the driven pack's radius grows by one thickness a turn, linearly in time. Returns the new
 * position and, when an end is reached, how much of the time that took.
 */
export function advanceTape(p, mode, seconds, wind) {
  const h = TAPE.thicknessMm / (2 * Math.PI);
  if (mode === 'play') {
    const next = p + seconds / SIDE_SECONDS;
    return next >= 1 ? {position: 1, end: true, used: (1 - p) * SIDE_SECONDS} : {position: next, end: false, used: seconds};
  }
  if (mode === 'ff' || mode === 'rew') {
    const driven = mode === 'ff' ? packRadius(p) : packRadius(1 - p), omega = mode === 'ff' ? wind.ff : wind.rew;
    const grown = driven + omega * h * seconds, full = TAPE.fullPackRadiusMm;
    if (grown >= full) return {position: mode === 'ff' ? 1 : 0, end: true, used: (full - driven) / (omega * h)};
    const share = shareAt(grown);
    return {position: mode === 'ff' ? share : 1 - share, end: false, used: seconds};
  }
  return {position: p, end: false, used: 0};
}

/** Playing time (s at speed 1) at position p: how far into the side the head is. */
export const tapeSeconds = p => clamp01(p) * SIDE_SECONDS;

/**
 * Weights of a mesh's tape keys at position p. Each key is the shape with one side's pack at a smaller radius; the
 * mesh itself is both packs full. The two keys either side of the pack's radius share the weight in proportion, so a
 * single key (a pack's 'empty') blends exactly and several (the ribbon's runs) follow a curve between samples.
 */
export function tapeKeyWeights(targets, p) {
  const radii = packRadii(p), weights = targets.map(() => 0);
  for (const side of ['supply', 'takeup']) {
    const keys = targets.map((t, i) => ({i, r: t.tape?.side === side ? t.tape.radius : null})).filter(k => k.r !== null).sort((a, b) => b.r - a.r);
    if (!keys.length) continue;
    const R = radii[side];
    let above = TAPE.fullPackRadiusMm, before = null;
    for (const key of keys) {
      if (R >= key.r) {
        const t = (above - R) / (above - key.r);
        weights[key.i] = t; if (before !== null) weights[before] = 1 - t;
        break;
      }
      above = key.r; before = key.i;
    }
    if (R < keys.at(-1).r) weights[keys.at(-1).i] = 1;
  }
  return weights;
}

// Parts that turn with each reel, and the drum that drives the take-up reel through its clutch.
export const REEL_SIDE = new Map([...TAPE.reels.supply.map(id => [id, 'supply']), ...TAPE.reels.takeup.map(id => [id, 'takeup']), ...TAPE.reels.drum.map(id => [id, 'drum'])]);
const TURN = 2 * Math.PI / TAPE.thicknessMm;   // radians a reel turns for each mm its pack gains or loses

/**
 * The reels' parts as the model was exported turn at fixed rates (equal 17 mm packs). spinOf(id) gives a part's spins
 * as exported (not the viewer's slowed display rates);
 * scale(id, mode, state) is the factor on a part's exported rate now, and phase(id, spin, mode, seconds, angles) the
 * angle it turns over a stretch in which its reel turned `angles[side]` (the tour's seek; seconds already scaled).
 */
export function reelSystem(spinOf) {
  const ref = (side, mode) => Math.abs(spinOf(TAPE.reels.reference[side])?.[mode]?.rate ?? 0);
  const refs = Object.fromEntries(['play', 'ff', 'rew'].map(m => [m, {supply: ref('supply', m), takeup: ref('takeup', m)}]));
  const drives = {wind: TAPE.windRadPerS, drum: TAPE.drumRadPerS};
  function scale(id, mode, state) {
    const side = REEL_SIDE.get(id); if (!side || !refs[mode]) return 1;
    const loaded = state.media === 'loaded', rates = reelRates(mode, state.tapePosition, {...drives, loaded});
    if (side === 'drum') return mode === 'rew' && loaded ? rates.takeup / refs.rew.takeup : 1;   // dragged with the take-up reel only in REW
    return refs[mode][side] ? rates[side] / refs[mode][side] : 1;
  }
  function phase(id, spin, mode, seconds, angles) {
    if (!spin) return 0;
    const side = REEL_SIDE.get(id), follows = side === 'drum' ? (mode === 'rew' ? 'takeup' : null) : side;
    return follows && angles && refs[mode]?.[follows] ? spin.rate / refs[mode][follows] * angles[follows] : spin.rate * seconds;
  }
  return {scale, phase};
}

/** How a tour stretch moves the tape and turns the reels: with tape moving, once per layer; otherwise at their rate. */
export function reelTurns(p, mode, seconds, {moving, loaded}) {
  if (mode === 'stop') return {position: p, turned: {supply: 0, takeup: 0}};
  if (moving) {
    const before = packRadii(p), position = advanceTape(p, mode, seconds, TAPE.windRadPerS).position, after = packRadii(position);
    return {position, turned: {supply: Math.abs(after.supply - before.supply) * TURN, takeup: Math.abs(after.takeup - before.takeup) * TURN}};
  }
  const r = reelRates(mode, p, {wind: TAPE.windRadPerS, drum: TAPE.drumRadPerS, loaded});
  return {position: p, turned: {supply: r.supply * seconds, takeup: r.takeup * seconds}};
}
