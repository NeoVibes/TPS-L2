import { audioMixForState, TONE_FILTER_PROFILES } from './shared/audio-policy.mjs';
import { isTapeMoving } from './operating-state.mjs';

export const AUDIO_DESCRIPTION = 'Music recorded on the tape (Canon in D) or a generated stereo test signal. Tone and Hot Line are illustrative simulations. No microphone access.';
// Browsers play a media element no slower than this (Chrome); slower, the music is silent rather than wrong.
export const MUSIC_MIN_RATE = 0.0625;
// Drift the music may have before it is put back at tape time. WebKit holds the music for about 0.2 s after every
// seek, so a small limit turns each correction into the next one: at 0.1 s Safari skipped about twice a second.
// A lag under a second is not heard against the moving tape; seeks of the tape itself are always exact.
export const MUSIC_DRIFT_SECONDS = 1;

// The buffer is synthesized locally, with distinct left/right tones and integer
// cycles for click-free looping. There are no uncleared media or network assets.
export function generateTestSignal(context, seconds = 4) {
  const frames = Math.round(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, frames, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const output = buffer.getChannelData(channel), fundamental = channel ? 330 : 220;
    for (let i = 0; i < frames; i++) {
      const t = i / context.sampleRate;
      output[i] = .12 * (Math.sin(2 * Math.PI * fundamental * t) + .25 * Math.sin(2 * Math.PI * (channel ? 4200 : 3600) * t)) * (.8 + .2 * Math.sin(2 * Math.PI * 2 * t));
    }
  }
  return buffer;
}

// The music is the tape's own recording: it plays when the tape plays, from the tape's position, at the motion speed
// and pitch, and is silent past its end while the tape runs on. loadMusic() resolves {url, duration, title, release};
// createMediaElement(url) makes the element that plays it into the same graph as the test signal.
export function createAudioEngine({ AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext, onStatus = () => {},
  loadMusic = null, createMediaElement = (url) => new Audio(url) } = {}) {
  let context = null, graph = null, source = null, roomSource = null, latest = null;
  let visible = true, disposed = false, activeRevision = -1, resumePending = null;
  // One music element, loaded once and kept; `generation` lets a newer request or disposal void a late load.
  let music = null, musicLoad = null, musicError = null, generation = 0, starting = null, blocked = false, musicRevision = -1;
  let status = { state: 'off', message: 'Sound off' };
  const report = (state, message) => {
    if (status.state === state && status.message === message) return;
    status = { state, message };
    onStatus(status);
  };
  const pauseMusic = () => { starting = null; if (music && !music.element.paused) music.element.pause(); };
  const stopSources = () => {
    for (const node of [source, roomSource]) if (node) { try { node.stop(); } catch {} node.disconnect(); }
    source = roomSource = null;
    activeRevision = -1;
    pauseMusic();
  };
  const stopTone = () => { if (source) { try { source.stop(); } catch {} source.disconnect(); } source = null; activeRevision = -1; };
  const ensureRoom = () => {
    if (roomSource) return;
    roomSource = context.createBufferSource(); roomSource.buffer = graph.roomSignal; roomSource.loop = true; roomSource.connect(graph.room); roomSource.start();
  };
  const wantsMusic = () => latest?.audioSource === 'music';
  const musicPlayable = () => Boolean(latest && !disposed && latest.audioEnabled && visible && !latest.muted && wantsMusic() && latest.mode === 'play' &&
    isTapeMoving(latest) && context?.state === 'running');
  function startMusicLoad() {
    if (!loadMusic) { musicError = 'this copy has no music'; return; }
    const ticket = ++generation;
    musicLoad = Promise.resolve().then(loadMusic).then((asset) => {
      if (disposed || ticket !== generation) { asset?.release?.(); return; }
      const element = createMediaElement(asset.url); element.preload = 'auto';
      const node = context.createMediaElementSource(element);
      node.connect(graph.direct); node.connect(graph.filter);
      music = { ...asset, element, node }; musicLoad = null;
      if (latest) sync(latest);
    }, (error) => {
      if (disposed || ticket !== generation) return;
      musicLoad = null; musicError = String(error?.message || error);
      if (latest) sync(latest);
    });
  }
  // Tape time is the authority: the music is put at it on a seek, or when it drifts more than MUSIC_DRIFT_SECONDS.
  function playMusic() {
    if (!music) { report('loading', 'Loading music…'); return; }
    const el = music.element, duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : music.duration;
    const tape = latest.tapePosition * latest.tapeDuration;
    if (tape >= duration) { pauseMusic(); report('ready', 'Past the end of the music · the tape runs on in silence'); return; }
    if (latest.speed < MUSIC_MIN_RATE) { pauseMusic(); report('ready', 'Music is silent below ' + MUSIC_MIN_RATE + '× motion speed'); return; }
    if (blocked) { pauseMusic(); report('blocked', 'Browser blocked the music · press Enable sound to retry'); return; }
    // Rate and pitch are written only when they differ, not on every frame.
    try { if (el.playbackRate !== latest.speed) el.playbackRate = latest.speed; } catch { pauseMusic(); report('ready', 'Music is silent at this motion speed'); return; }
    if ('preservesPitch' in el) { if (el.preservesPitch) el.preservesPitch = false; } else if (el.webkitPreservesPitch) el.webkitPreservesPitch = false;
    if (musicRevision !== latest.tapeRevision || (!el.seeking && Math.abs(el.currentTime - tape) > MUSIC_DRIFT_SECONDS)) { el.currentTime = tape; musicRevision = latest.tapeRevision; }
    if (el.paused && !starting) {
      const attempt = starting = Promise.resolve(el.play());
      attempt.then(() => {
        if (starting !== attempt) return;
        starting = null;
        if (!musicPlayable()) el.pause();   // STOP, a source change or Reset while the start was pending
      }, () => {
        if (starting !== attempt) return;   // superseded: a pause aborts a pending start
        starting = null;
        if (!musicPlayable()) return;
        blocked = true; el.pause(); report('blocked', 'Browser blocked the music · press Enable sound to retry');   // no automatic retry
      });
    }
    report('playing', latest.hotline ? 'Hot Line simulation over the music · generated room signal, no microphone' : 'Playing ' + (music.title || 'the music'));
  }
  const setValue = (param, value) => {
    param.cancelScheduledValues(context.currentTime);
    param.setTargetAtTime(value, context.currentTime, .015);
  };
  function createGraph() {
    context = new AudioContextClass();
    const direct = context.createGain(), filter = context.createBiquadFilter(), filtered = context.createGain();
    const duck = context.createGain(), room = context.createGain(), splitter = context.createChannelSplitter(2);
    const left = context.createGain(), right = context.createGain(), merger = context.createChannelMerger(2), master = context.createGain();
    direct.connect(duck); filter.connect(filtered); filtered.connect(duck); duck.connect(splitter); room.connect(splitter);
    splitter.connect(left, 0); splitter.connect(right, 1); left.connect(merger, 0, 0); right.connect(merger, 0, 1); merger.connect(master);
    // What reaches the speakers passes an analyser, so checks can tell sound from silence (level()).
    const meter = context.createAnalyser?.(); if (meter) { meter.fftSize = 2048; master.connect(meter); meter.connect(context.destination); } else master.connect(context.destination);
    filter.type = TONE_FILTER_PROFILES.low.type;
    filter.frequency.value = TONE_FILTER_PROFILES.low.frequency;
    filter.Q.value = TONE_FILTER_PROFILES.low.q;
    master.gain.value = 0;
    const signal = generateTestSignal(context), roomSignal = context.createBuffer(2, context.sampleRate * 4, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const samples = roomSignal.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) {
        const t = i / context.sampleRate;
        samples[i] = .055 * Math.sin(2 * Math.PI * 480 * t + 2 * Math.sin(2 * Math.PI * 3 * t)) * (.6 + .4 * Math.sin(2 * Math.PI * 4 * t));
      }
    }
    graph = { direct, filter, filtered, duck, room, left, right, master, signal, roomSignal, meter };
    context.onstatechange = () => { if (!disposed && latest) sync(latest); };
  }
  function sync(state) {
    if (disposed) return status;
    latest = { ...state };
    const playable = latest.mode === 'play' && isTapeMoving(latest);
    if (graph) {
      const mix = audioMixForState(latest);
      setValue(graph.left.gain, mix.left); setValue(graph.right.gain, mix.right);
      setValue(graph.duck.gain, mix.ducking);
      setValue(graph.direct.gain, mix.toneFilter.enabled ? 0 : 1); setValue(graph.filtered.gain, mix.toneFilter.enabled ? 1 : 0);
      setValue(graph.room.gain, latest.hotline ? 1 : 0);
      setValue(graph.master.gain, latest.audioEnabled && !latest.muted && visible && playable ? 1 : 0);
    }
    if (latest.audioEnabled && wantsMusic() && context && graph && !music && !musicLoad && !musicError) startMusicLoad();
    if (!latest.audioEnabled) { stopSources(); report('off', 'Sound off'); }
    else if (!visible) { stopSources(); report('background', 'Sound suspended while this page is hidden'); }
    else if (!context) {
      if (status.state !== 'unavailable') report('off', 'Press Enable sound to hear ' + (wantsMusic() ? 'the music' : 'the test tone'));
    }
    else if (context.state !== 'running') {
      stopSources();
      report('blocked', 'Sound is suspended · press Enable sound to retry');
    } else if (latest.muted) { stopSources(); report('muted', 'Sound muted'); }
    else if (wantsMusic() && musicError) { stopSources(); report('error', 'Music could not be loaded (' + musicError + ') · press Enable sound to retry, or choose the test tone'); }
    else if (!playable) { stopSources(); report(wantsMusic() && !music ? 'loading' : 'ready', latest.paused ? 'Sound paused with the transport' : wantsMusic() && !music ? 'Loading music…' : 'Sound ready · press PLAY'); }
    else if (wantsMusic()) { stopTone(); ensureRoom(); playMusic(); }
    else {
      pauseMusic();
      if (source && activeRevision !== latest.tapeRevision) stopSources();
      if (!source) {
        source = context.createBufferSource(); source.buffer = graph.signal; source.loop = true;
        source.connect(graph.direct); source.connect(graph.filter);
        source.playbackRate.value = latest.speed;
        source.start(0, (latest.tapePosition * latest.tapeDuration) % graph.signal.duration);
        ensureRoom();
        activeRevision = latest.tapeRevision;
      }
      setValue(source.playbackRate, latest.speed);
      report('playing', latest.hotline ? 'Hot Line simulation · generated room signal, no microphone' : 'Playing generated stereo test signal');
    }
    return status;
  }
  async function resume() {
    if (resumePending) return resumePending;
    resumePending = (async () => {
      try {
        await context.resume();
        if (!disposed && latest) sync(latest);
      } catch {
        stopSources();
        if (!disposed) report('blocked', 'Browser blocked sound · press Enable sound to retry');
      }
      return status;
    })();
    try { return await resumePending; } finally { resumePending = null; }
  }
  async function enable(state) {
    if (disposed) return status;
    state.audioEnabled = true;
    musicError = null; blocked = false;   // the user's own press: try again
    latest = { ...state };
    if (!AudioContextClass) { report('unavailable', 'Web Audio is unavailable in this browser'); return status; }
    if (!context) {
      try { createGraph(); }
      catch {
        const failed = context;
        context = graph = null;
        try { await failed?.close(); } catch {}
        report('unavailable', 'Could not initialize sound · the model remains usable');
        return status;
      }
    }
    // Only enable() (a deliberate gesture) creates the context. sync() never
    // tries to bypass autoplay policy or creates fresh contexts after rejection.
    return resume();
  }
  async function setVisibility(isVisible) {
    visible = Boolean(isVisible);
    if (latest) sync(latest);
    if (visible && latest?.audioEnabled && context && context.state !== 'running') return resume();
    return status;
  }
  async function dispose() {
    disposed = true; generation++;
    stopSources();
    if (music) {
      music.node.disconnect(); music.element.removeAttribute?.('src'); music.element.load?.();
      music.release?.(); music = null;
    }
    if (context) {
      context.onstatechange = null;
      try { await context.close(); } catch {}
    }
    graph = null;
  }
  /** Root-mean-square of what is reaching the speakers now (0 for silence). */
  function level() {
    if (!graph?.meter) return 0;
    const samples = new Float32Array(graph.meter.fftSize); graph.meter.getFloatTimeDomainData(samples);
    return Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
  }
  return { enable, sync, setVisibility, dispose, level, get status() { return { ...status }; },
    get music() { return { loaded: Boolean(music), loading: Boolean(musicLoad), error: musicError, duration: music ? (Number.isFinite(music.element.duration) && music.element.duration > 0 ? music.element.duration : music.duration) : null,
      time: music ? music.element.currentTime : null, playing: Boolean(music && !music.element.paused) }; } };
}
