// Execute the real frame callback with DOM, renderer and controller doubles.
// The renderer advances a controlled clock to reproduce slow software WebGL;
// no browser, Blender files or source-text assertions are needed.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../viewer/app-core.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function animate(now) {');
const end = source.indexOf('\nexport async function init()', start);
assert.ok(start >= 0 && end > start, 'The frame callback must be available to execute');
const callback = new vm.Script(source.slice(start, end), {filename: 'app-core.mjs:animate'});

function frameLoop() {
  let clock = 0, renderCost = 0, nextDraws = 0, nextTriangles = 0, renders = 0;
  const elements = new Map(['stage', 'tapePosition', 'tapeValue', 'fps'].map(id => [id, {dataset: {}, value: null, textContent: ''}]));
  const renderer = {
    info: {render: {calls: 0, triangles: 0}},
    render() {
      renders++;
      clock += renderCost;
      Object.assign(this.info.render, {calls: nextDraws, triangles: nextTriangles});
    },
    getPixelRatio: () => 1,
  };
  const context = vm.createContext({
    requestAnimationFrame() {}, performance: {now: () => clock}, window: {}, document: {hidden: false},
    $: id => elements.get(id), lastObservation: 0, lastTime: 0, frameNumber: 0, dirty: true, settleUntil: 3000,
    state: {view: 'assembled', mode: 'stop', paused: false, stopCycle: null, autoStop: null, explode: 0, radial: 0,
      tour: -1, media: 'loaded', door: false, tapePosition: 0, stopTravel: 0},
    cam: {moving: false, step() {}, updateClipRange() {}}, orbit: {update() {}}, scene: {}, camera: {near: 1, far: 2000},
    renderer, labels: {update() {}, visibleAssemblies: () => []}, audio: {sync() {}},
    transportInterval: () => ({seconds: 0, mode: 'stop'}), advanceOperating() {}, views: {sync() {}},
    updateParts() {}, reducedMotion: {matches: true}, tour: {seek() {}, position: 0},
    displayBattery: 0, displayExplosion: 0, displayRadial: 0, ejectTravel: () => 0,
    packages: {loaded: new Set(['exterior'])}, parts: [{data: {id: 'MEC-011'}, group: {visible: true}, phase: 0}],
    metrics: {frames: [], sampleKey: 'assembled/stop', motionSampling: false},
  });
  callback.runInContext(context);
  return {
    context, elements,
    tick(now, {cost = 0, draws = 12, triangles = 2400} = {}) {
      clock = now; renderCost = cost; nextDraws = draws; nextTriangles = triangles;
      context.animate(now);
    },
    observation: () => JSON.parse(elements.get('stage').dataset.test || 'null'),
    get renders() { return renders; },
  };
}

test('A first render that exhausts the settling window publishes geometry before going idle', () => {
  const loop = frameLoop();
  loop.tick(1000, {cost: 2500});
  loop.tick(4000);
  assert.equal(loop.renders, 1, 'The idle callback must not render again');
  const observation = loop.observation();
  assert.ok(observation, 'A successful render must publish diagnostics even before frame 15');
  assert.equal(observation.frames, 1);
  assert.equal(observation.draws, 12);
  assert.equal(observation.triangles, 2400);
});

test('Geometry arriving after an empty first frame remains observable after a slow second frame', () => {
  const loop = frameLoop();
  loop.tick(1000, {cost: 1200, draws: 0, triangles: 0});
  loop.tick(2400, {cost: 1200, draws: 20, triangles: 5000});
  loop.tick(4000);
  assert.equal(loop.renders, 2);
  const observation = loop.observation();
  assert.ok(observation, 'The last rendered geometry must remain observable when animation becomes idle');
  assert.equal(observation.frames, 2);
  assert.equal(observation.draws, 20);
  assert.equal(observation.triangles, 5000);
});

test('Every rendered frame refreshes diagnostics while visible tape and FPS text stay throttled', () => {
  const loop = frameLoop();
  for (let frame = 1; frame <= 14; frame++) loop.tick(frame * 16);
  assert.equal(loop.elements.get('tapePosition').value, null);
  loop.tick(15 * 16);
  assert.equal(loop.elements.get('tapePosition').value, 0);
  loop.context.state.view = 'catalog';
  loop.tick(16 * 16, {draws: 30, triangles: 7000});
  const observation = loop.observation();
  assert.equal(observation.frames, 16, 'Diagnostics cannot retain the previous throttled sample');
  assert.equal(observation.view, 'catalog');
  assert.equal(observation.draws, 30);
  assert.equal(observation.triangles, 7000);
});
