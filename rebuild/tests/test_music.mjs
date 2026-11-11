// The music path of the audio engine (viewer/audio.mjs) with a mocked context, loader and media element: it plays
// the tape's recording at tape time and motion speed, and nothing late, stale or blocked can start it.
import './test_setup.mjs';
import assert from 'node:assert/strict';
import { createOperatingState, dispatchOperating, advanceOperating, resetOperating } from '../viewer/operating-state.mjs';
import { createAudioEngine, MUSIC_MIN_RATE, MUSIC_DRIFT_SECONDS } from '../viewer/audio.mjs';

const act = (state, type, values = {}) => dispatchOperating(state, { type, ...values });
const tick = () => new Promise(r => setTimeout(r, 0));
class Param { constructor() { this.value = 0; } cancelScheduledValues() {} setTargetAtTime(v) { this.value = v; } }
class Node { constructor(owner) { this.owner = owner; this.gain = new Param(); this.frequency = new Param(); this.Q = new Param(); this.playbackRate = new Param(); }
  connect() {} disconnect() { this.disconnected = true; } start() { this.owner.active.add(this); } stop() { this.owner.active.delete(this); } }
class Context {
  constructor() { this.sampleRate = 8000; this.currentTime = 0; this.state = 'suspended'; this.active = new Set(); this.destination = {}; Context.latest = this; }
  node() { return new Node(this); }
  createGain() { return this.node(); } createBiquadFilter() { return this.node(); } createChannelSplitter() { return this.node(); }
  createChannelMerger() { return this.node(); } createBufferSource() { return this.node(); }
  createMediaElementSource(element) { const n = this.node(); n.element = element; return n; }
  createBuffer(channels, frames, rate) { const d = Array.from({length: channels}, () => new Float32Array(frames)); return {duration: frames / rate, getChannelData: i => d[i]}; }
  async resume() { this.state = 'running'; this.onstatechange?.(); } async close() { this.state = 'closed'; }
}
class Media {
  static block = false; static made = [];
  constructor(url) { this.src = url; this.paused = true; this.currentTime = 0; this.duration = NaN; this.playbackRate = 1; this.seeking = false; this.preservesPitch = true; Media.made.push(this); }
  play() { if (Media.block) return Promise.reject(new Error('NotAllowedError')); this.paused = false; this.plays = (this.plays || 0) + 1; return Promise.resolve(); }
  pause() { this.paused = true; }
  set playbackRate(v) { if (v < MUSIC_MIN_RATE) throw new Error('NotSupportedError'); this._rate = v; } get playbackRate() { return this._rate; }
  removeAttribute() { this.src = ''; } load() {}
}
function setup({fail = false, hold = false} = {}) {
  let release, released = 0, loads = 0;
  const loadMusic = () => { loads++; const asset = {url: 'blob:music', duration: 114.47, title: 'Canon in D', release: () => released++};
    if (fail) return Promise.reject(new Error('missing'));
    return hold ? new Promise(r => { release = () => r(asset); }) : Promise.resolve(asset); };
  const audio = createAudioEngine({AudioContextClass: Context, loadMusic, createMediaElement: url => new Media(url)});
  return {audio, release: () => release(), stats: () => ({loads, released})};
}
const playing = (speed = 1, position = .05) => { const s = createOperatingState({speed, tapePosition: position}); act(s, 'transport', {mode: 'play'}); return s; };
const element = () => Media.made.at(-1);

// Plays at tape time and speed, pitch not kept; enabling in STOP prepares without starting the tape.
{ const {audio, stats} = setup(), s = createOperatingState({speed: .55, tapePosition: .1});
  assert.equal(s.audioSource, 'music');
  audio.sync(s); assert.equal(stats().loads, 0, 'nothing is read before sound is enabled');
  await audio.enable(s); await tick(); audio.sync(s);
  assert.equal(stats().loads, 1); assert.equal(s.mode, 'stop'); assert.equal(audio.status.state, 'ready'); assert.ok(element().paused);
  act(s, 'transport', {mode: 'play'}); audio.sync(s); await tick();
  const el = element(); assert.equal(audio.status.state, 'playing'); assert.equal(el.paused, false);
  assert.equal(el.playbackRate, .55); assert.equal(el.preservesPitch, false); assert.equal(el.currentTime, .1 * s.tapeDuration, 'starts at the tape\'s time');
  // Steady running is not re-seeked, nor are rate and pitch rewritten; drift over MUSIC_DRIFT_SECONDS is put back.
  advanceOperating(s, 1); el.currentTime += .55; audio.sync(s); assert.ok(Math.abs(el.currentTime - s.tapePosition * s.tapeDuration) < 1e-9);
  let writes = 0; const rate = Object.getOwnPropertyDescriptor(Media.prototype, 'playbackRate');
  Object.defineProperty(el, 'playbackRate', {configurable: true, get: () => rate.get.call(el), set: v => { writes++; rate.set.call(el, v); }});
  for (let i = 0; i < 5; i++) audio.sync(s); assert.equal(writes, 0, 'an unchanged rate is not written again'); delete el.playbackRate;
  el.currentTime -= MUSIC_DRIFT_SECONDS - .05; audio.sync(s); assert.ok(Math.abs(el.currentTime - s.tapePosition * s.tapeDuration + MUSIC_DRIFT_SECONDS - .05) < 1e-9, 'within the limit it is left alone');
  el.currentTime -= .1; audio.sync(s); assert.ok(Math.abs(el.currentTime - s.tapePosition * s.tapeDuration) < 1e-9, 'past the limit it is put back');
  act(s, 'seek', {position: .05}); audio.sync(s); assert.ok(Math.abs(el.currentTime - .05 * s.tapeDuration) < 1e-9, 'a seek moves it');
  // Below the slowest rate, and past its end: silent, the tape runs on.
  act(s, 'speed', {value: .05}); audio.sync(s); assert.ok(el.paused); assert.match(audio.status.message, /silent below/);
  act(s, 'speed', {value: 1}); act(s, 'seek', {position: 190 / s.tapeDuration}); audio.sync(s); assert.ok(el.paused); assert.match(audio.status.message, /past the end/i); assert.equal(s.mode, 'play');
  // Source switch at 75%: same tape, mode and speed; never both at once; switching back resumes.
  act(s, 'seek', {position: .75}); act(s, 'audio-source', {value: 'tone'}); audio.sync(s);
  assert.equal(s.tapePosition, .75); assert.equal(s.mode, 'play'); assert.ok(el.paused);
  act(s, 'seek', {position: .05}); act(s, 'audio-source', {value: 'music'}); audio.sync(s); await tick(); assert.equal(el.paused, false);
  // STOP, disable and hiding silence it; disposal releases it.
  act(s, 'transport', {mode: 'stop'}); audio.sync(s); assert.ok(el.paused);
  act(s, 'transport', {mode: 'play'}); audio.sync(s); await tick(); assert.equal(el.paused, false);
  await audio.setVisibility(false); assert.ok(el.paused); await audio.setVisibility(true); await tick(); assert.equal(el.paused, false);
  act(s, 'audio-enable', {enabled: false}); audio.sync(s); assert.ok(el.paused); assert.equal(audio.status.state, 'off');
  await audio.dispose(); assert.equal(stats().released, 1); assert.equal(el.src, ''); assert.equal(Media.made.length, 1, 'one element, ever'); }

// A load that finishes after STOP, a source switch, Reset, disabling or disposal starts nothing.
for (const [name, after] of [['STOP', s => act(s, 'transport', {mode: 'stop'})], ['source switch', s => act(s, 'audio-source', {value: 'tone'})],
  ['Reset', s => resetOperating(s)], ['disable', s => act(s, 'audio-enable', {enabled: false})]]) {
  const {audio, release} = setup({hold: true}), s = playing();
  await audio.enable(s); audio.sync(s); assert.equal(audio.status.state, 'loading', name);
  after(s); audio.sync(s); release(); await tick(); await tick();
  assert.ok(element().paused, name + ': a late load starts nothing'); await audio.dispose();
}
{ const {audio, release, stats} = setup({hold: true}), s = playing(); await audio.enable(s); audio.sync(s);
  await audio.dispose(); const made = Media.made.length; release(); await tick(); await tick();
  assert.equal(Media.made.length, made, 'disposal voids a late load'); assert.equal(stats().released, 1, 'and releases what it brought'); }

// A storm of switches: one load, one element, the latest choice wins.
{ const {audio, stats} = setup(), s = playing(); const made = Media.made.length;
  await audio.enable(s); for (let i = 0; i < 50; i++) { act(s, 'audio-source', {value: i % 2 ? 'music' : 'tone'}); audio.sync(s); }
  await tick(); audio.sync(s); await tick();
  assert.equal(stats().loads, 1); assert.equal(Media.made.length, made + 1); assert.equal(s.audioSource, 'music'); assert.equal(element().paused, false);
  assert.equal(Context.latest.active.size, 1, 'music uses a single looping room signal after repeated source changes');
  act(s, 'transport', {mode: 'stop'}); audio.sync(s);
  assert.equal(Context.latest.active.size, 0, 'STOP silences and releases all looping sources');
  await audio.dispose(); }

// The browser blocks the start: the tape runs on silently, no automatic retry; choosing the music again tries again.
{ const {audio} = setup(), s = playing(); Media.block = true;
  await audio.enable(s); await tick(); audio.sync(s); await tick(); await tick();
  assert.equal(audio.status.state, 'blocked'); assert.match(audio.status.message, /choose Mute, then the music again/); assert.equal(s.mode, 'play');
  const el = element(); audio.sync(s); audio.sync(s); await tick(); assert.equal(el.plays || 0, 0, 'no retry by itself');
  Media.block = false; await audio.enable(s); await tick(); audio.sync(s); await tick(); assert.equal(el.paused, false); await audio.dispose(); }

// A missing file: a clear error with its two ways out; the tone still plays.
{ const {audio} = setup({fail: true}), s = playing(); await audio.enable(s); await tick(); await tick(); audio.sync(s);
  assert.equal(audio.status.state, 'error'); assert.match(audio.status.message, /retry.*test tone/);
  act(s, 'audio-source', {value: 'tone'}); audio.sync(s); assert.equal(audio.status.state, 'playing'); await audio.dispose(); }
console.log('music: tape time and speed, drift, seek, floor, end, switching, STOP, hiding, disabling, late loads, storms, blocked starts and a missing file behave as the plan says');
