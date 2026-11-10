// Plugging an accessory in (config: accessories.plugs): a cut to its plugged-in place with the plug's tip at the
// socket's mouth, then the plug slides in; unplugging slides it out, then cuts back. The places and the cord's shape
// along the slide are sampled from the Blender file; this only times them. insertion: 0 at the mouth, 1 seated.

/** The state an accessory shows: its chosen socket in the assembled view with the accessories shown, else unplugged. */
export const plugTarget = (state, key) => state.accessories && state.view === "assembled" && !state.explode && !state.radial ? state[key] : "out";

/** Advances one accessory's plug ({shown, insertion}) towards target by dt seconds (Infinity: at once). */
export function stepPlug(motion, target, dt, seconds) {
  let left = dt / seconds;
  for (let phase = 0; phase < 4; phase++) {
    if (motion.shown === target) {
      if (target !== "out" && motion.insertion < 1) { const d = Math.min(left, 1 - motion.insertion); motion.insertion += d; left -= d; }
      return motion;
    }
    if (motion.shown !== "out" && motion.insertion > 0) {   // out of the socket first
      const d = Math.min(left, motion.insertion); motion.insertion -= d; left -= d;
      if (motion.insertion > 0) return motion;
    }
    motion.shown = target; motion.insertion = target === "out" ? 1 : 0;   // the cut
  }
  return motion;
}

/** True while a plug is still on its way to what the state asks for. */
export const plugMoving = (state, motions) => Object.entries(motions).some(([key, m]) => m.shown !== plugTarget(state, key) || (m.shown !== "out" && m.insertion < 1));
