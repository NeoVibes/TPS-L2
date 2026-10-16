import './test_setup.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createOperatingState, dispatchOperating, advanceOperating, autoStopProgress, isTapeMoving, AUTO_STOP, TRANSPORT_RATES } from '../viewer/operating-state.mjs';
import config from '../config/model.json' with {type:'json'};

// Automatic shut-off. A side that runs out in PLAY stalls the reel; the mechanism then releases the
// transport. Nothing may trip while tape is left, and the sequence must leave everything reset.
const act = (state, type, values = {}) => dispatchOperating(state, { type, ...values });
const whole = AUTO_STOP.detect + AUTO_STOP.trip;

// Normal running: no false trip at any point of a side.
const running = createOperatingState({ speed: 1 });
act(running, 'transport', { mode: 'play' });
for (let i = 0; i < 1000; i++) { advanceOperating(running, running.tapeDuration * .999 / 1000); assert.equal(running.autoStop, null, 'tripped with tape left'); assert.equal(running.mode, 'play'); }
assert.deepEqual(autoStopProgress(running), { stalled: false, mesh: 0, trip: 0 });

// The reel stalls at the end of the side: the transport stays in PLAY while the mechanism works, then releases.
advanceOperating(running, running.tapeDuration * .002);
assert.equal(running.tapePosition, 1); assert.equal(running.mode, 'play', 'the button stays down until the lever trips'); assert.ok(running.autoStop);
assert.equal(isTapeMoving(running), false, 'a stalled reel moves no tape');
let last = autoStopProgress(running), sawMesh = false, sawTrip = false;
for (let i = 0; i < 400 && running.mode === 'play'; i++) {
  advanceOperating(running, whole / 200);
  const now = autoStopProgress(running);
  if (running.autoStop) { assert.ok(now.mesh >= last.mesh - 1e-12 && now.trip >= last.trip - 1e-12, 'the sequence only runs forward'); assert.ok(now.trip === 0 || now.mesh === 1, 'the lever is carried along only once its teeth are in mesh'); sawMesh ||= now.mesh > 0 && now.mesh < 1; sawTrip ||= now.trip > 0 && now.trip < 1; last = now; }
}
assert.ok(sawMesh && sawTrip, 'both stages were passed through');
assert.equal(running.mode, 'stop', 'the mechanism released the transport'); assert.equal(running.autoStop, null, 'and reset');
assert.deepEqual(autoStopProgress(running), { stalled: false, mesh: 0, trip: 0 });

// It takes the mechanism's own time whatever the frame rate, and scales with the motion speed like the rest.
for (const speed of [.5, 1, 2]) {
  const coarse = createOperatingState({ speed, tapePosition: 1 }); act(coarse, 'transport', { mode: 'play' });
  advanceOperating(coarse, whole / speed * .98); assert.equal(coarse.mode, 'play');
  advanceOperating(coarse, whole / speed * .04); assert.equal(coarse.mode, 'stop');
}
// One long step from mid-tape lands in the same place: the time left after the tape ran out goes to the mechanism.
const jump = createOperatingState({ speed: 1, tapePosition: .5 }); act(jump, 'transport', { mode: 'play' });
advanceOperating(jump, jump.tapeDuration * .5 + whole * .5); assert.equal(jump.mode, 'play'); assert.ok(Math.abs(jump.autoStop.elapsed - whole * .5) < 1e-9);
advanceOperating(jump, whole); assert.equal(jump.mode, 'stop');

// Pausing holds it; winding back, pressing a key or taking the cassette out calls it off.
const held = createOperatingState({ tapePosition: 1 }); act(held, 'transport', { mode: 'play' }); advanceOperating(held, .1);
act(held, 'pause'); advanceOperating(held, 60); assert.equal(held.mode, 'play'); act(held, 'pause');
act(held, 'seek', { position: .5 }); advanceOperating(held, .01); assert.equal(held.autoStop, null, 'tape again: the reel turns and the lever is held back');
act(held, 'seek', { position: 1 }); advanceOperating(held, .1); assert.ok(held.autoStop);
act(held, 'transport', { mode: 'rew' }); assert.equal(held.autoStop, null); advanceOperating(held, .01); assert.equal(held.mode, 'rew');
const empty = createOperatingState({ tapePosition: 1, door: true }); act(empty, 'transport', { mode: 'play' }); advanceOperating(empty, .1); assert.ok(empty.autoStop);
act(empty, 'cassette'); advanceOperating(empty, 60); assert.equal(empty.autoStop, null); assert.equal(empty.mode, 'play', 'no cassette, no stalled reel');

// The exposed mechanism can be watched doing it: in the service view the tape does not run, but a side set to its end still trips.
const service = createOperatingState({ speed: 1, tapePosition: 1 }); service.view = 'service'; act(service, 'transport', { mode: 'play' });
advanceOperating(service, whole * 1.1); assert.equal(service.mode, 'stop');

// Fast winding ends a side at once, as before, and winds faster than playing by what the model's drive gives.
const wind = createOperatingState({ tapePosition: .9 }); act(wind, 'transport', { mode: 'ff' }); advanceOperating(wind, 600);
assert.equal(wind.mode, 'stop'); assert.equal(wind.autoStop, null);
assert.ok(TRANSPORT_RATES.ff > 10 && TRANSPORT_RATES.ff < 15 && -TRANSPORT_RATES.rew > 9 && -TRANSPORT_RATES.rew < 13 && TRANSPORT_RATES.ff > -TRANSPORT_RATES.rew, 'forward winding is the quicker of the two');

// The model carries the positions the sequence passes through, and they differ where they should.
const model = JSON.parse((await readFile(new URL('../../view/geometry/model.js', import.meta.url), 'utf8')).replace(/^[^{]*/, '').replace(/\);?\s*$/, ''));
const parts = Object.fromEntries(model.meta.parts.map((p) => [p.id, p])), moved = (id, a, b) => parts[id].poses[a].flat().some((v, i) => Math.abs(v - parts[id].poses[b].flat()[i]) > 1e-6);
for (const id of config.roles.autoStop.lever) { assert.ok(moved(id, 'play', 'shutoff_out'), id + ' rocks with the cam'); assert.ok(moved(id, 'play', 'shutoff_meshed'), id + ' comes into mesh'); assert.ok(!moved(id, 'stop', 'play'), id + ' rests where it is held'); }
assert.deepEqual(config.roles.autoStop.lever.filter((id) => moved(id, 'shutoff_meshed', 'shutoff_tripped')), ['STF-012'], 'only the toothed piece is driven along the lever by the third gear\'s pinion');
for (const id of config.roles.autoStop.detector) { assert.ok(moved(id, 'play', 'shutoff_meshed'), id + ' falls back'); assert.ok(!moved(id, 'play', 'shutoff_out')); assert.ok(!moved(id, 'shutoff_meshed', 'stop'), id + ' ends where it rests'); }
for (const id of config.roles.autoStop.release) { assert.ok(!moved(id, 'play', 'shutoff_meshed'), id + ' waits'); assert.ok(moved(id, 'shutoff_meshed', 'shutoff_tripped'), id + ' is turned by the lever'); }
for (const id of [...config.roles.reelDriven, config.roles.autoStop.cam]) assert.ok(parts[id], id + ' is a part');
for (const id of config.roles.reelDriven) assert.ok(parts[id].spin.play, id + ' turns in PLAY');
const others = model.meta.parts.filter((p) => !Object.values(config.roles.autoStop).flat().includes(p.id) && ['shutoff_out', 'shutoff_meshed', 'shutoff_tripped'].some((k) => moved(p.id, 'play', k)));
assert.deepEqual(others.map((p) => p.id), [], 'nothing else moves with the shut-off');
console.log('Automatic shut-off: no trip with tape left; a stalled reel trips and resets; positions present.');
