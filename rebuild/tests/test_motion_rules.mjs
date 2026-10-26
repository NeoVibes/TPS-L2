import './test_setup.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spinStopped, shutOffStaged } from '../viewer/motion-rules.mjs';
import config from '../config/model.json' with {type:'json'};

// What turns in each transport mode, and what the shut-off lever does there. Only the tape turns the reel side the
// motor does not drive, so with no cassette seated that side stands still while everything driven keeps turning.
const model = JSON.parse((await readFile(new URL('../../view/geometry/model.js', import.meta.url), 'utf8')).replace(/^[^{]*/, '').replace(/\);?\s*$/, ''));
const parts = Object.fromEntries(model.meta.parts.map((p) => [p.id, p]));
const modes = ['play', 'ff', 'rew'];
const turning = (mode) => model.meta.parts.filter((p) => p.spin?.[mode] && !p.is_cassette).map((p) => p.id);
const supply = ['BAY-021', 'BAY-031', 'DRV-010', 'DRV-011', 'DRV-100'];
const takeUp = ['BAY-020', 'BAY-030', 'CLT-010', 'CLT-030', 'CLT-031', 'CLT-032', 'DRV-014', 'DRV-017', 'DRV-104'];
assert.deepEqual(config.roles.tapeDragged, { play: supply, ff: supply, rew: takeUp }, 'the supply side is tape-turned in PLAY and FF, the take-up side in REW');
for (const mode of modes) {
  for (const id of config.roles.tapeDragged[mode]) assert.ok(parts[id]?.spin?.[mode], id + ' turns in ' + mode.toUpperCase() + ' when a cassette is seated');
  for (const media of ['removed', 'ejected', 'loaded']) {
    const stopped = turning(mode).filter((id) => spinStopped(id, mode, { media, autoStop: null }));
    assert.deepEqual(stopped.sort(), media === 'loaded' ? [] : [...config.roles.tapeDragged[mode]].sort(), mode + ' with the cassette ' + media);
  }
  // Everything the motor drives keeps turning with no cassette: motor, belts' pulleys, flywheel and capstan, the gear trains, the driven reel side.
  const driven = turning(mode).filter((id) => !spinStopped(id, mode, { media: 'removed', autoStop: null }));
  for (const id of ['MTR-005', 'MEC-011', 'BAY-052', 'DRV-020', 'DRV-022', 'CAM-010']) assert.ok(driven.includes(id), id + ' still turns in ' + mode.toUpperCase() + ' without a cassette');
  for (const id of mode === 'rew' ? supply : takeUp.filter((id) => parts[id].spin[mode])) assert.ok(driven.includes(id), id + ' is driven in ' + mode.toUpperCase());
}
assert.deepEqual(supply.filter((id) => takeUp.includes(id)), [], 'the two reel sides share no part');
// A stalled reel still stops its own side, cassette or not.
for (const id of config.roles.reelDriven) assert.ok(spinStopped(id, 'play', { media: 'loaded', autoStop: { elapsed: 1 } }), id + ' stands while the reel is stalled');

// The lever rides the cam in every mode; detection and tripping only in PLAY.
for (const mode of ['stop', ...modes]) {
  assert.equal(shutOffStaged('lever', mode), true, 'the lever follows the cam in ' + mode.toUpperCase());
  for (const role of ['detector', 'release']) assert.equal(shutOffStaged(role, mode), mode === 'play', role + ' in ' + mode.toUpperCase());
}
// That is sound only because the lever stands in the same place in STOP, PLAY, FF and REW, with the cover open or not:
// the same rock between 'play' and 'shutoff_out' then applies.
const same = (id, a, b) => parts[id].poses[a].flat().every((v, i) => Math.abs(v - parts[id].poses[b].flat()[i]) <= 1e-6) && (parts[id].links || []).every((l) => l.poses[a].every((v, i) => Math.abs(v - l.poses[b][i]) <= 1e-9));
const everyPose = Object.keys(parts['STF-010'].poses).filter((k) => !k.startsWith('shutoff') && !k.startsWith('battery'));
for (const id of config.roles.autoStop.lever) for (const pose of everyPose) assert.ok(same(id, pose, 'play'), id + ' stands as in PLAY in ' + pose);
console.log('Motion rules: tape-turned reel sides stop without a cassette (' + supply.length + ' supply parts in PLAY/FF, ' + takeUp.length + ' take-up parts in REW); the lever follows the cam in every mode.');
