// Pure transport regression checks: no exported or packed geometry is needed.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createOperatingState, dispatchOperating, advanceOperating, AUTO_STOP, OPERATING_POLICY} from '../viewer/operating-state.mjs';

const act = (state, type, values = {}) => dispatchOperating(state, {type, ...values});
const tapeTimeEqual = (state, expected) => assert.ok(
  Math.abs(state.tapePosition - expected) * state.tapeDuration <= 1e-6,
  `Tape position ${state.tapePosition} differs from ${expected} by more than one microsecond of tape time`,
);
function stalled(speed = 1) {
  const state = createOperatingState({view: 'assembled', tapePosition: 1, speed});
  act(state, 'transport', {mode: 'play'});
  advanceOperating(state, .1);
  assert.ok(state.autoStop);
  return state;
}

test('Seeking away from automatic shut-off integrates the entire next second', () => {
  const state = stalled();
  assert.equal(state.tapeDuration, OPERATING_POLICY.tapeDurationSeconds);
  act(state, 'seek', {position: .5});
  advanceOperating(state, 1);
  tapeTimeEqual(state, .5 + 1 / state.tapeDuration);
  assert.equal(state.autoStop, null);
  assert.equal(state.mode, 'play');
});

test('Seek cancellation is immediately visible to the audio/controller caller', () => {
  const state = stalled();
  act(state, 'seek', {position: .5});
  assert.equal(state.autoStop, null);
});

test('One step and many steps after seeking consume the same tape time at every supported speed', () => {
  for (const speed of [.05, .55, 1, 2]) {
    const coarse = stalled(speed), fine = stalled(speed);
    for (const state of [coarse, fine]) act(state, 'seek', {position: .5});
    advanceOperating(coarse, 3);
    for (let i = 0; i < 300; i++) advanceOperating(fine, .01);
    tapeTimeEqual(coarse, .5 + 3 * speed / coarse.tapeDuration);
    tapeTimeEqual(fine, coarse.tapePosition);
  }
});

test('Obsolete auto-stop state is reconciled before integration even without a seek dispatch', () => {
  const state = stalled();
  state.tapePosition = .5;
  advanceOperating(state, 1);
  tapeTimeEqual(state, .5 + 1 / state.tapeDuration);
  assert.equal(state.autoStop, null);
});

test('Seeking during pause holds the new position until resume', () => {
  const state = stalled();
  act(state, 'pause');
  act(state, 'seek', {position: .5});
  advanceOperating(state, 20);
  tapeTimeEqual(state, .5);
  act(state, 'pause');
  advanceOperating(state, 1);
  tapeTimeEqual(state, .5 + 1 / state.tapeDuration);
});

test('Seeking to the stalled end preserves the active cycle, and reaching it again starts a fresh one', () => {
  const state = stalled(), cycle = state.autoStop;
  act(state, 'seek', {position: 1});
  assert.equal(state.autoStop, cycle);
  act(state, 'seek', {position: .5});
  advanceOperating(state, state.tapeDuration / 2 + .25);
  tapeTimeEqual(state, 1);
  assert.ok(Math.abs(state.autoStop.elapsed - .25) <= 1e-6);
  advanceOperating(state, AUTO_STOP.detect + AUTO_STOP.trip);
  assert.equal(state.mode, 'stop');
  assert.equal(state.autoStop, null);
});
