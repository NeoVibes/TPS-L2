import './test_setup.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createOperatingState, dispatchOperating, advanceOperating, resetOperating, OPERATING_POLICY } from '../viewer/operating-state.mjs';
import { createAudioEngine, generateTestSignal } from '../viewer/audio.mjs';

const act = (state, type, values = {}) => dispatchOperating(state, { type, ...values });
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

// Time comes from elapsed seconds, not rendered frames: a low-frame-rate tour
// or transport yields the same tape location as many small updates.
const smooth = createOperatingState({ speed: .8 }), slow = createOperatingState({ speed: .8 });
act(smooth, 'transport', { mode: 'play' }); act(slow, 'transport', { mode: 'play' });
for (let frame = 0; frame < 600; frame++) advanceOperating(smooth, 1 / 60);
for (let frame = 0; frame < 10; frame++) advanceOperating(slow, 1);
approx(smooth.tapePosition, slow.tapePosition);
approx(slow.tapePosition, 8 / 120);
act(slow, 'pause'); advanceOperating(slow, 60); approx(slow.tapePosition, 8 / 120);
act(slow, 'seek', { position: .7 }); advanceOperating(slow, 60); approx(slow.tapePosition, .7);
act(slow, 'pause'); act(slow, 'transport', { mode: 'rew' }); advanceOperating(slow, 120);
assert.equal(slow.mode, 'stop'); assert.equal(slow.tapePosition, 0);
act(slow, 'transport', { mode: 'ff' }); advanceOperating(slow, 120);
assert.equal(slow.mode, 'stop'); assert.equal(slow.tapePosition, 1);

const state = createOperatingState({ tapePosition: .35 });
act(state, 'transport', { mode: 'play' }); act(state, 'stop-eject');
assert.equal(state.mode,'play','Button must travel before transport release'); advanceOperating(state,2);
assert.equal(state.mode, 'stop'); assert.equal(state.door, false); assert.equal(state.media, 'loaded');
act(state, 'stop-eject'); advanceOperating(state,2);assert.equal(state.door,false);assert.equal(state.media,'loaded');assert.equal(state.ejectNeedsOpenCover,true);
act(state,'door');act(state,'stop-eject');advanceOperating(state,2);assert.equal(state.door,true);assert.equal(state.media,'ejected');
act(state, 'transport', { mode: 'play' }); assert.equal(state.mode, 'play');
act(state, 'cassette'); assert.equal(state.media, 'removed');
act(state, 'door'); act(state, 'cassette'); assert.equal(state.media, 'removed', 'Cannot load through closed cover');
act(state, 'door'); act(state, 'cassette'); act(state, 'door'); act(state, 'transport', { mode: 'play' });
assert.equal(state.mode, 'play'); approx(state.tapePosition, .35+.18/120);
act(state, 'door'); assert.equal(state.mode, 'play');
act(state, 'volume', { channel: 'left', value: 0 }); assert.equal(state.volumeLeft, 0); assert.equal(state.volumeRight, .5);
state.view = 'service'; state.explode = .7; resetOperating(state);
assert.equal(state.view, 'service'); assert.equal(state.explode, .7); assert.equal(state.audioEnabled, false);
assert.equal(OPERATING_POLICY.confidence, 'illustrative');

// Reproduce interleavings that previously allowed independently mutated UI and
// transport state to disagree. Invalid numerical input must not poison a frame.
const mixed = createOperatingState();
let seed = 123456;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const actions = [
  () => act(mixed, 'transport', { mode: ['play', 'ff', 'rew'][Math.floor(random() * 3)] }),
  () => act(mixed, 'stop-eject'), () => act(mixed, 'door'), () => act(mixed, 'cassette'),
  () => act(mixed, 'pause'), () => act(mixed, 'seek', { position: random() * 3 - 1 }),
  () => act(mixed, 'volume', { channel: random() < .5 ? 'left' : 'right', value: random() * 3 - 1 }),
  () => act(mixed, 'speed', { value: random() * 3 }), () => act(mixed, 'tone', { value: random() < .5 ? 'high' : 'low' }),
  () => act(mixed, 'hotline'), () => act(mixed, 'mute'), () => act(mixed, 'audio-enable'),
];
for (let i = 0; i < 2000; i++) {
  actions[Math.floor(random() * actions.length)](); advanceOperating(mixed, random() * 5);
  assert.ok(mixed.tapePosition >= 0 && mixed.tapePosition <= 1);
  assert.ok(mixed.volumeLeft >= 0 && mixed.volumeLeft <= 1 && mixed.volumeRight >= 0 && mixed.volumeRight <= 1);
  assert.ok(['stop','play','ff','rew'].includes(mixed.mode));
}
act(mixed, 'seek', { position: NaN }); act(mixed, 'speed', { value: Infinity }); advanceOperating(mixed, NaN);
assert.ok(Number.isFinite(mixed.tapePosition)); assert.ok(Number.isFinite(mixed.speed));

class Param {
  constructor(value = 1) { this.value = value; }
  cancelScheduledValues() {}
  setTargetAtTime(value) { this.value = value; }
}
class Node {
  constructor(owner) { this.owner = owner; this.gain = new Param(); this.frequency = new Param(); this.Q = new Param(); this.playbackRate = new Param(); this.connections = []; }
  connect(...args) { this.connections.push(args); }
  disconnect() { this.connections = []; }
  start(when = 0, offset = 0) { this.offset = offset; this.started = true; this.owner.active.add(this); }
  stop() { this.stopped = true; this.owner.active.delete(this); }
}
class MockContext {
  static instances = [];
  static rejectNext = false;
  constructor() { this.sampleRate = 12000; this.currentTime = 0; this.state = 'suspended'; this.active = new Set(); this.destination = {}; this.nodes = []; MockContext.instances.push(this); }
  node() { const node = new Node(this); this.nodes.push(node); return node; }
  createGain() { return this.node(); }
  createBiquadFilter() { return this.node(); }
  createChannelSplitter() { return this.node(); }
  createChannelMerger() { return this.node(); }
  createBufferSource() { return this.node(); }
  createBuffer(channels, frames, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(frames));
    return { duration: frames / sampleRate, getChannelData: i => data[i] };
  }
  async resume() { if (MockContext.rejectNext) { MockContext.rejectNext = false; throw new Error('Autoplay blocked'); } this.state = 'running'; this.onstatechange?.(); }
  async close() { this.state = 'closed'; this.active.clear(); }
}

const soundState = createOperatingState({ mode: 'play', tapePosition: .3, speed: .7 });
const statuses = [], audio = createAudioEngine({ AudioContextClass: MockContext, onStatus: s => statuses.push(s.state) });
audio.sync(soundState); assert.equal(MockContext.instances.length, 0, 'sync must not initialize audio before gesture');
MockContext.rejectNext = true; await audio.enable(soundState);
const context = MockContext.instances.at(-1);
assert.equal(audio.status.state, 'blocked'); assert.equal(context.active.size, 0);
await audio.enable(soundState); assert.equal(MockContext.instances.length, 1, 'Retry must reuse the existing context');
assert.equal(audio.status.state, 'playing'); assert.equal(context.active.size, 2);
const firstSource = [...context.active][0]; approx(firstSource.playbackRate.value, .7); approx(firstSource.offset, 0);
const signal = generateTestSignal(context, 1);
assert.notDeepEqual(signal.getChannelData(0), signal.getChannelData(1), 'Stereo channels carry distinct generated tones');
assert.ok(signal.getChannelData(0).every(sample => Number.isFinite(sample) && Math.abs(sample) <= .15));
act(soundState, 'volume', { channel: 'left', value: 0 }); act(soundState, 'volume', { channel: 'right', value: 1 });
act(soundState, 'hotline', { active: true }); act(soundState, 'tone', { value: 'low' }); audio.sync(soundState);
assert.equal(audio.status.state, 'playing'); assert.match(audio.status.message, /no microphone/);
const [direct, filter, filtered, duck, room, , left, right] = context.nodes;
assert.equal(direct.gain.value, 0); assert.equal(filtered.gain.value, 1); assert.equal(filter.frequency.value, 2400);
assert.equal(duck.gain.value, .16); assert.equal(room.gain.value, 1); assert.equal(left.gain.value, 0); assert.equal(right.gain.value, 1);
act(soundState, 'seek', { position: .325 }); audio.sync(soundState);
assert.equal(firstSource.stopped, true); approx([...context.active][0].offset, 3);
act(soundState, 'pause'); audio.sync(soundState); assert.equal(context.active.size, 0); assert.equal(audio.status.state, 'ready');
act(soundState, 'pause'); audio.sync(soundState); assert.equal(context.active.size, 2);
await audio.setVisibility(false); assert.equal(context.active.size, 0); assert.equal(audio.status.state, 'background');
context.state = 'suspended'; MockContext.rejectNext = true;
await audio.setVisibility(true); assert.equal(audio.status.state, 'blocked');
await audio.enable(soundState); assert.equal(context.active.size, 2);
act(soundState, 'mute'); audio.sync(soundState); assert.equal(audio.status.state, 'muted'); assert.equal(context.active.size, 0);
act(soundState, 'mute'); act(soundState, 'transport', { mode: 'ff' }); audio.sync(soundState); assert.equal(context.active.size, 0);
act(soundState, 'transport', { mode: 'play' }); audio.sync(soundState); assert.equal(context.active.size, 2);
act(soundState, 'door'); audio.sync(soundState); assert.equal(context.active.size, 2, 'Opening a cover does not silence engaged tape');
act(soundState, 'cassette'); audio.sync(soundState); assert.equal(context.active.size, 0, 'Empty transport has no tape program');
assert.equal(soundState.mode,'play');
resetOperating(soundState); audio.sync(soundState); assert.equal(audio.status.state, 'off');
await audio.dispose(); assert.equal(context.state, 'closed');
assert.ok(statuses.includes('background') && statuses.includes('blocked') && statuses.includes('playing'));

const unavailable = createAudioEngine({ AudioContextClass: null });
const unavailableState = createOperatingState();
await unavailable.enable(unavailableState); unavailable.sync(unavailableState);
assert.equal(unavailable.status.state, 'unavailable'); await unavailable.dispose();

class FailedInitContext extends MockContext {
  static fail = true;
  createBuffer(...args) { if (FailedInitContext.fail) { FailedInitContext.fail = false; throw new Error('Temporary buffer initialization failure'); } return super.createBuffer(...args); }
}
const retryInitState = createOperatingState({ mode: 'play' }), retryInit = createAudioEngine({ AudioContextClass: FailedInitContext });
await retryInit.enable(retryInitState); assert.equal(retryInit.status.state, 'unavailable');
assert.equal(MockContext.instances.at(-1).state, 'closed', 'Failed initialization must release its context');
await retryInit.enable(retryInitState); assert.equal(retryInit.status.state, 'playing'); await retryInit.dispose();

// An enable promise may settle after a stop/reset/visibility action. It must
// use the latest state, rather than revive the stale PLAY request.
let releaseResume;
class DelayedContext extends MockContext { resume() { return new Promise(resolve => { releaseResume = () => { this.state = 'running'; resolve(); }; }); } }
const pendingState = createOperatingState({ mode: 'play' });
const delayedAudio = createAudioEngine({ AudioContextClass: DelayedContext });
const pendingEnable = delayedAudio.enable(pendingState);
resetOperating(pendingState); delayedAudio.sync(pendingState); releaseResume(); await pendingEnable;
assert.equal(delayedAudio.status.state, 'off'); assert.equal(MockContext.instances.at(-1).active.size, 0); await delayedAudio.dispose();

const sourceHashes = {};
for (const path of ['viewer/operating-state.mjs','viewer/audio.mjs','viewer/shared/audio-policy.mjs','tests/test_operating.mjs']) sourceHashes[path] = createHash('sha256').update(await readFile(path)).digest('hex');
await writeFile('build/test-results/operating-tests.json', JSON.stringify({
  passed: true, sourceHashes,
  checks: ['elapsed-time consistency','2000 mixed operating actions','stop/eject/loading and reset','independent stereo volumes','tone and Hot Line simulation','autoplay denial and retry','background recovery','failed initialization cleanup','stale async resume'],
  scope: 'Module and mocked audio tests; not physical or browser verification.',
}, null, 2) + '\n');
console.log('Operating state and generated audio: time-step consistency, mixed actions, stereo/tone/Hot Line, autoplay denial, background recovery, stale resume and reset passed.');
