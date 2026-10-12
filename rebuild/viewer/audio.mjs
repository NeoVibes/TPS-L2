import { audioMixForState, TONE_FILTER_PROFILES } from './shared/audio-policy.mjs';
import { isTapeMoving } from './operating-state.mjs';

export const AUDIO_DESCRIPTION = 'Generated stereo test signal. Tone and Hot Line are illustrative simulations. No recording or microphone access.';

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

export function createAudioEngine({ AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext, onStatus = () => {} } = {}) {
  let context = null, graph = null, source = null, roomSource = null, latest = null;
  let visible = true, disposed = false, activeRevision = -1, resumePending = null;
  let status = { state: 'off', message: 'Sound off · generated test signal available' };
  const report = (state, message) => {
    if (status.state === state && status.message === message) return;
    status = { state, message };
    onStatus(status);
  };
  const stopSources = () => {
    for (const node of [source, roomSource]) if (node) { try { node.stop(); } catch {} node.disconnect(); }
    source = roomSource = null;
    activeRevision = -1;
  };
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
    splitter.connect(left, 0); splitter.connect(right, 1); left.connect(merger, 0, 0); right.connect(merger, 0, 1); merger.connect(master); master.connect(context.destination);
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
    graph = { direct, filter, filtered, duck, room, left, right, master, signal, roomSignal };
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
    if (!latest.audioEnabled) { stopSources(); report('off', 'Sound off · generated test signal available'); }
    else if (!visible) { stopSources(); report('background', 'Sound suspended while this page is hidden'); }
    else if (!context) {
      if (status.state !== 'unavailable') report('off', 'Enable sound to hear the generated test signal');
    }
    else if (context.state !== 'running') {
      stopSources();
      report('blocked', 'Sound is suspended · press Enable sound to retry');
    } else if (latest.muted) { stopSources(); report('muted', 'Sound muted'); }
    else if (!playable) { stopSources(); report('ready', latest.paused ? 'Sound paused with the transport' : 'Sound ready · press PLAY'); }
    else {
      if (source && activeRevision !== latest.tapeRevision) stopSources();
      if (!source) {
        source = context.createBufferSource(); source.buffer = graph.signal; source.loop = true;
        source.connect(graph.direct); source.connect(graph.filter);
        source.playbackRate.value = latest.speed;
        source.start(0, (latest.tapePosition * latest.tapeDuration) % graph.signal.duration);
        roomSource = context.createBufferSource(); roomSource.buffer = graph.roomSignal; roomSource.loop = true; roomSource.connect(graph.room); roomSource.start();
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
    disposed = true;
    stopSources();
    if (context) {
      context.onstatechange = null;
      try { await context.close(); } catch {}
    }
    graph = null;
  }
  return { enable, sync, setVisibility, dispose, get status() { return { ...status }; } };
}
