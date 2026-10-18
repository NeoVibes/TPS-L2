// Import the real page wiring with only app-core's WebGL startup boundary replaced.
// Every input/click/key below invokes the callback registered by app.js, with the
// production transport, views, camera and OrbitControls implementations behind it.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {after, beforeEach, test} from 'node:test';
import * as T from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {createCamera} from '../viewer/app-camera.mjs';
import {createViews} from '../viewer/app-views.mjs';
import {createOperatingState, advanceOperating, STOP_CYCLE} from '../viewer/operating-state.mjs';

// These page controls need no model-hit geometry; retain the production transport
// with an empty native control inventory instead of loading a generated export.
const originalData = globalThis.portableTapePlayerData;
globalThis.portableTapePlayerData = {model: {motion: {controls: {}, active_owner_ids: []}}};
const {createTransport} = await import('../viewer/app-transport.mjs');

class Target {
  constructor(dataset = {}) {
    this.dataset = dataset; this.listeners = new Map(); this.style = {}; this.value = '';
    this.attributes = {}; this.clientWidth = 800; this.clientHeight = 600;
  }
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push(callback); this.listeners.set(type, callbacks);
  }
  removeEventListener(type, callback) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== callback));
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  setPointerCapture() {}
  getRootNode() { return document; }
  getBoundingClientRect() { return {left: 0, top: 0, width: 800, height: 600}; }
  emit(type, values = {}) {
    const event = {target: this, button: 0, pointerId: 1, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...values};
    this['on' + type]?.(event);
    for (const callback of this.listeners.get(type) || []) callback(event);
    return event;
  }
  click() { if (!this.disabled) this.emit('click'); }
}
const originalDocument = globalThis.document, originalWindow = globalThis.window;
const elements = new Map(), $ = id => {
  if (!elements.has(id)) elements.set(id, new Target());
  return elements.get(id);
};
const viewButtons = ['assembled', 'service', 'exploded', 'catalog'].map(view => new Target({view}));
const transportButtons = ['play', 'ff', 'rew'].map(mode => new Target({mode}));
globalThis.document = Object.assign(new Target(), {body: new Target(), querySelectorAll(selector) {
  if (selector === 'button[data-view]') return viewButtons;
  if (selector === 'button[data-mode]') return transportButtons;
  return [];
}});
globalThis.window = new Target();
const state = {}, stage = {camera: new T.PerspectiveCamera(32, 1, .1, 6000), renderer: {clippingPlanes: []}};
$('canvas').ownerDocument = document;
stage.orbit = new OrbitControls(stage.camera, $('canvas'));
stage.orbit.minDistance = 6; stage.orbit.maxDistance = 12000;
const audio = {status: {state: 'disabled'}, sync() {}}, packages = {ensure: async () => {}, ensureAll() {}, loaded: new Set()};
const tour = {clear() { state.tour = -1; }, position: 0};
const invalidate = () => {}, presets = [];
const cam = createCamera({$, state, parts: [], stage, layout: () => null, invalidate,
  reducedMotion: {matches: false}, replaceCamera(next) { stage.camera = next; harness.updateCamera?.(next); }});
const realPreset = cam.preset;
cam.preset = view => { presets.push(view); realPreset(view); };
let views;
const transport = createTransport({$, state, parts: [], stage, packages, audio, invalidate,
  clearTour: tour.clear, sync: () => views.sync(), spread: () => ({radial: state.radial, explosion: state.explode}),
  inspectPart() {}, setOrbitEnabled(enabled) { stage.orbit.enabled = enabled; }});
views = createViews({$, state, parts: [], stage, packages, cam, transport, audio, invalidate,
  clearTour: tour.clear, tourPosition: () => 0, tourSteps: [], clearInspectionContext() {}, select() {}, onExterior() {}});
const harness = {$, state, model: undefined, orbit: stage.orbit, V: values => new T.Vector3().fromArray(values),
  markGraphicsUnavailable() {}, saveViewerPreferences() {}, audio, metrics: {}, invalidate, cam, reset() {}, init() {}, packages, transport, views, inspect: {dismiss() {}}, tour,
  motionCueEnabled: {value: 1}, stage};
const harnessKey = '__portableTapePlayerInputTest';
globalThis[harnessKey] = harness;
const coreURL = new URL('../viewer/app-core.mjs', import.meta.url).href;
const hooks = registerHooks({load(url, context, nextLoad) {
  if (url !== coreURL) return nextLoad(url, context);
  const exports = Object.keys(harness).filter(key => key !== 'stage').map(key => `export const ${key} = h.${key};`).join('\n');
  return {format: 'module', shortCircuit: true, source: `const h = globalThis[${JSON.stringify(harnessKey)}];\n${exports}\nexport let camera = h.stage.camera; h.updateCamera = next => { camera = next; };`};
}});
resetFixture();
await import('../viewer/app.js');
hooks.deregister();

function resetFixture() {
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, createOperatingState({speed: 1}), {view: 'assembled', explode: 0, radial: 0,
    uiMode: 'operate', tour: -1, category: 'all', subsystem: 'all', section: 'off', sectionOffset: 0});
  cam.stop();
  stage.camera.position.set(0, 0, 340); stage.orbit.target.set(0, 0, 0);
  cam.setProjection('perspective');
  stage.orbit.update(); presets.length = 0;
  views.sync();
}
beforeEach(resetFixture);
after(() => {
  stage.orbit.dispose();
  globalThis.document = originalDocument; globalThis.window = originalWindow;
  globalThis.portableTapePlayerData = originalData;
  delete globalThis[harnessKey];
});
const setSpread = value => { $('spread').value = String(value); return $('spread').emit('input'); };
const chooseView = view => viewButtons.find(button => button.dataset.view === view).click();
const key = value => $('canvas').emit('keydown', {key: value});
const fullStroke = STOP_CYCLE.press + STOP_CYCLE.hold + STOP_CYCLE.release;

for (const mode of ['play', 'stop']) for (const separateVia of ['slider', 'catalog', 'exploded']) for (const returnVia of ['slider', 'button']) {
  test(`${separateVia} cancels an unfinished ${mode === 'play' ? 'STOP' : 'EJECT'} before reassembly by ${returnVia}`, () => {
    state.door = true;
    transport.operation({type: 'transport', mode});
    $('eject').click();
    advanceOperating(state, STOP_CYCLE.press / 2);
    assert.ok(state.stopCycle);
    if (separateVia === 'slider') setSpread(50); else chooseView(separateVia);
    assert.equal(state.stopCycle, null, 'The input callback must cancel the stroke immediately');
    assert.equal(state.stopTravel, 0);
    if (returnVia === 'slider') setSpread(0); else chooseView('assembled');
    advanceOperating(state, fullStroke * 2);
    assert.equal(state.mode, 'stop'); assert.equal(state.media, 'loaded');
    assert.equal(state.stopCycle, null); assert.equal(state.stopTravel, 0);
  });
}

test('View buttons and separation both immediately cancel automatic shut-off and held controls', () => {
  for (const change of [() => setSpread(50), () => chooseView('exploded')]) {
    resetFixture(); state.tapePosition = 1;
    transport.operation({type: 'transport', mode: 'play'});
    advanceOperating(state, .1); assert.ok(state.autoStop);
    $('hotline').emit('pointerdown'); assert.equal(state.hotline, true);
    change();
    assert.equal(state.autoStop, null); assert.equal(state.hotline, false);
    assert.equal(state.mode, 'stop');
  }
});

test('Separation preserves committed ejection and the slider’s catalog/radial mapping and camera thresholds', () => {
  state.door = true; $('eject').click(); advanceOperating(state, STOP_CYCLE.press);
  assert.equal(state.media, 'ejected');
  setSpread(5); assert.equal(state.view, 'catalog'); assert.equal(state.explode, .05);
  assert.equal(state.radial, 0); assert.deepEqual(presets, []);
  setSpread(50); assert.equal(presets.at(-1), 'catalog');
  setSpread(0); assert.equal(state.view, 'assembled'); assert.equal(presets.at(-1), 'assembled');
  assert.equal(state.media, 'ejected');
  chooseView('exploded'); setSpread(30);
  assert.equal(state.view, 'exploded'); assert.equal(state.radial, .3); assert.equal(state.explode, 0);
  setSpread(0); assert.equal(state.view, 'assembled');
  setSpread(30); assert.equal(state.view, 'catalog');
});

function projectedWidth() {
  stage.orbit.update(); stage.camera.updateMatrixWorld();
  return new T.Vector3(-10, 0, 0).project(stage.camera).distanceTo(new T.Vector3(10, 0, 0).project(stage.camera));
}
for (const projection of ['perspective', 'orthographic']) {
  test(`The actual +/- callbacks change projected size in ${projection}`, () => {
    $('projection').value = projection; $('projection').emit('change');
    const initial = projectedWidth(), position = stage.camera.position.clone();
    assert.equal(key('+').defaultPrevented, true);
    const larger = projectedWidth(); assert.ok(larger > initial, 'Plus must enlarge the projected object');
    key('-'); assert.ok(projectedWidth() < larger, 'Minus must shrink the projected object');
    if (projection === 'orthographic') assert.ok(stage.camera.position.distanceTo(position) < 1e-9);
  });

  test(`Keyboard zoom shares finite limits with the real OrbitControls wheel in ${projection}`, () => {
    cam.setProjection(projection);
    for (let i = 0; i < 500; i++) key('+');
    if (projection === 'orthographic') {
      assert.ok(Number.isFinite(stage.orbit.maxZoom));
      assert.equal(stage.camera.zoom, stage.orbit.maxZoom);
    } else assert.ok(Math.abs(stage.camera.position.distanceTo(stage.orbit.target) - stage.orbit.minDistance) < 1e-8);
    const maximum = projectedWidth();
    $('canvas').emit('wheel', {deltaY: -100, deltaMode: 0});
    assert.ok(Math.abs(projectedWidth() - maximum) < 1e-8);
    for (let i = 0; i < 500; i++) key('-');
    if (projection === 'orthographic') {
      assert.ok(stage.orbit.minZoom > 0); assert.equal(stage.camera.zoom, stage.orbit.minZoom);
    } else assert.ok(Math.abs(stage.camera.position.distanceTo(stage.orbit.target) - stage.orbit.maxDistance) < 1e-8);
    const minimum = projectedWidth();
    $('canvas').emit('wheel', {deltaY: 100, deltaMode: 0});
    assert.ok(Math.abs(projectedWidth() - minimum) < 1e-8);
  });
}

test('Keyboard input cancels the preset glide and ignores unrelated keys', () => {
  cam.to([0, 0, 0], [100, 0, 400]); assert.equal(cam.moving, true);
  assert.equal(key('x').defaultPrevented, false); assert.equal(cam.moving, true);
  key('+'); const position = stage.camera.position.clone();
  assert.equal(cam.moving, false); cam.step(1);
  assert.ok(stage.camera.position.distanceTo(position) < 1e-9);
});

test('Orthographic limits follow a preset’s new vertical frustum', () => {
  cam.setProjection('orthographic');
  cam.to([0, 0, 0], [0, 0, 600]);
  assert.ok(Math.abs(stage.orbit.minZoom - 600 / stage.orbit.maxDistance) < 1e-12);
  assert.ok(Math.abs(stage.orbit.maxZoom - 600 / stage.orbit.minDistance) < 1e-12);
});

test('Arrow keys rotate around the target without changing orthographic scale', () => {
  cam.setProjection('orthographic');
  const distance = stage.camera.position.distanceTo(stage.orbit.target), zoom = stage.camera.zoom;
  const before = stage.camera.position.clone();
  assert.equal(key('ArrowLeft').defaultPrevented, true);
  assert.ok(stage.camera.position.distanceTo(before) > 0);
  key('ArrowUp');
  assert.ok(Math.abs(stage.camera.position.distanceTo(stage.orbit.target) - distance) < 1e-9);
  assert.equal(stage.camera.zoom, zoom);
});
