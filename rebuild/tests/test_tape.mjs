// The tape (viewer/tape.mjs): pack sizes, reel rates, winding and the keys that follow them, against the physics
// they stand for, and the model's own numbers they are taken from.
import './test_setup.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import config from '../config/model.json' with {type: 'json'};
import {TAPE, TAPE_LENGTH_MM, SIDE_SECONDS, packRadii, reelRates, advanceTape, tapeKeyWeights, reelSystem, reelTurns} from '../viewer/tape.mjs';

const close = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const {emptyPackRadiusMm: Re, fullPackRadiusMm: Rf, thicknessMm: h, speedMmPerS: v, windRadPerS: wind, drumRadPerS: drum} = TAPE;
const drives = {wind, drum};

// The model's numbers: the capstan's surface speed, the spindles' winding rates and the drum's PLAY rate as exported.
const model = JSON.parse((await readFile(new URL('../../view/geometry/model.js', import.meta.url), 'utf8')).replace(/^[^{]*/, '').replace(/\);?\s*$/, ''));
const spin = id => model.meta.parts.find(p => p.id === id).spin;
const capstan = JSON.parse(await readFile(new URL('../../edit/targets.json', import.meta.url), 'utf8')).targets.find(t => t.id === 'capstan.diameter').value;
close(v, Math.abs(spin('BAY-052').play.rate) * capstan / 2, .01, 'tape speed is the capstan surface speed');
close(wind.ff, Math.abs(spin(TAPE.reels.reference.takeup).ff.rate), 1e-9, 'FF winding rate is the take-up spindle\'s');
close(wind.rew, Math.abs(spin(TAPE.reels.reference.supply).rew.rate), 1e-9, 'REW winding rate is the supply spindle\'s');
close(drum, Math.abs(spin(TAPE.reels.drum[0]).play.rate), 1e-9, 'the drum rate is the drum\'s');
assert.ok(drum > v / Re, 'the drum must turn faster than the take-up reel ever needs to, or the slipping clutch could not drive it');
assert.ok(Re > TAPE.hubRadiusMm && TAPE.thicknessMm >= .015 && TAPE.thicknessMm <= .019, 'an empty pack is on the hub; thickness within ECMA-34 4.1.3.1');
for (const side of ['supply', 'takeup']) for (const id of TAPE.reels[side]) assert.ok(model.meta.parts.some(p => p.id === id && p.spin), id + ' is a spinning part');

// Length, side and pack sizes: the tape's area is the same however it is shared.
close(TAPE_LENGTH_MM, Math.PI * (Rf ** 2 - Re ** 2) / h, 1e-6, 'tape length');
close(SIDE_SECONDS, TAPE_LENGTH_MM / v, 1e-9, 'side');
assert.deepEqual(packRadii(0), {supply: Rf, takeup: Re}); assert.deepEqual(packRadii(1), {supply: Re, takeup: Rf});
for (const p of [0, .1, .37, .5, .9, 1]) { const r = packRadii(p); close(r.supply ** 2 + r.takeup ** 2, Rf ** 2 + Re ** 2, 1e-9, 'area at ' + p); }

// Rates: in PLAY both packs' surfaces move at tape speed; winding, the driven reel keeps its rate and the other follows.
for (const p of [0, .25, .5, .75, 1]) {
  const r = packRadii(p), play = reelRates('play', p, drives), ff = reelRates('ff', p, drives), rew = reelRates('rew', p, drives);
  close(play.supply * r.supply, v, 1e-9, 'supply surface in PLAY'); close(play.takeup * r.takeup, v, 1e-9, 'take-up surface in PLAY');
  assert.ok(play.takeup < drum, 'the take-up reel slips behind its drum');
  close(ff.takeup, wind.ff, 0, 'FF drives the take-up reel'); close(ff.supply * r.supply, ff.takeup * r.takeup, 1e-9, 'one tape, one speed (FF)');
  close(rew.supply, wind.rew, 0, 'REW drives the supply reel'); close(rew.takeup * r.takeup, rew.supply * r.supply, 1e-9, 'one tape, one speed (REW)');
}
assert.deepEqual(reelRates('play', .3, {...drives, loaded: false}), {supply: 0, takeup: drum}, 'without tape the take-up reel turns with its drum');

// Winding: the exact advance against small steps of dp = ω r dt / L; the end of a side in each mode.
for (const [mode, p0] of [['ff', .1], ['rew', .8]]) {
  let p = p0; const dt = 1e-3;
  for (let i = 0; i < 20000; i++) { const r = packRadii(p); p += (mode === 'ff' ? wind.ff * r.takeup : -wind.rew * r.supply) * dt / TAPE_LENGTH_MM; }
  close(advanceTape(p0, mode, 20, wind).position, p, 2e-6, mode + ' over 20 s');
}
for (const [mode, omega] of [['ff', wind.ff], ['rew', wind.rew]]) {
  const whole = 2 * Math.PI * (Rf - Re) / (omega * h), start = mode === 'ff' ? 0 : 1;
  close(advanceTape(start, mode, whole * 2, wind).used, whole, 1e-9, mode + ' winds a side in ' + whole.toFixed(1) + ' s');
  assert.equal(advanceTape(start, mode, whole * .999, wind).end, false);
}
{ const end = advanceTape(.999, 'play', 10, wind); assert.equal(end.position, 1); assert.equal(end.end, true); close(end.used, .001 * SIDE_SECONDS, 1e-9, 'PLAY ends a side'); }
close(advanceTape(.25, 'play', 60, wind).position, .25 + 60 / SIDE_SECONDS, 1e-12, 'PLAY moves steadily');

// A reel turns once for every layer its pack gains or loses.
{ const run = reelTurns(.2, 'play', 100, {moving: true, loaded: true}), r0 = packRadii(.2), r1 = packRadii(run.position);
  let turned = 0; for (let t = 0, p = .2; t < 100; t += .001) { turned += v / packRadii(p).takeup * .001; p += .001 / SIDE_SECONDS; }
  close(run.turned.takeup, 2 * Math.PI * (r1.takeup - r0.takeup) / h, 1e-9, 'layers'); close(run.turned.takeup, turned, 1e-3, 'take-up turns over 100 s of PLAY'); }

// Keys: one key blends exactly; several share their weight between the two either side; a full pack has none.
const pack = [{tape: {side: 'takeup', radius: Re}}];
assert.deepEqual(tapeKeyWeights(pack, 1), [0]); assert.deepEqual(tapeKeyWeights(pack, 0), [1]);
const mid = packRadii(.4).takeup; close(tapeKeyWeights(pack, .4)[0], (Rf - mid) / (Rf - Re), 1e-12, 'pack key');
const ribbon = [16, 13, 10.6].map(r => ({tape: {side: 'supply', radius: r}}));
assert.deepEqual(tapeKeyWeights(ribbon, 0), [0, 0, 0]);
const at = r => { const p = 1 - (r * r - Re * Re) / (Rf * Rf - Re * Re); return tapeKeyWeights(ribbon, p).map(w => +w.toFixed(9)); };
assert.deepEqual(at(16), [1, 0, 0]); assert.deepEqual(at(14.5), [.5, .5, 0]); assert.deepEqual(at(Re), [0, 0, 1]);
close(at(18).reduce((a, b) => a + b), (Rf - 18) / (Rf - 16), 1e-9, 'between full and the first key');

// Parts: every reel part turns at its reel's rate over its exported rate; the drum only follows in REW.
const reels = reelSystem(spin), state = p => ({tapePosition: p, media: 'loaded'});
close(reels.scale('BAY-030', 'play', state(0)), v / Re / Math.abs(spin('BAY-030').play.rate), 1e-12, 'take-up spindle at the start of a side');
close(reels.scale('DRV-011', 'play', state(.5)), reels.scale('BAY-031', 'play', state(.5)), 1e-12, 'S gear B keeps its ratio to the supply reel');
assert.equal(reels.scale('CLT-030', 'play', state(.5)), 1, 'the drum keeps its own rate in PLAY');
close(reels.scale('CLT-030', 'rew', state(.5)), reels.scale('BAY-030', 'rew', state(.5)), 1e-12, 'and turns with the take-up reel in REW');
assert.equal(reels.scale('BAY-052', 'play', state(.5)), 1, 'the capstan is not a reel');
close(reels.scale('BAY-030', 'play', {tapePosition: .5, media: 'removed'}), drum / Math.abs(spin('BAY-030').play.rate), 1e-12, 'no cassette: with the drum');
assert.equal(config.deformation.channels.tape['MEDIA-004'], 'supply'); assert.equal(config.deformation.channels.tape['MEDIA-006'], 'takeup');
console.log(`tape: ${(TAPE_LENGTH_MM / 1000).toFixed(1)} m, side ${(SIDE_SECONDS / 60).toFixed(1)} min; packs, rates, winding, keys and reel parts agree with the physics and the model`);
