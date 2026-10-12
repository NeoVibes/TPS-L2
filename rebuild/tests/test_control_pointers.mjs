import './test_setup.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { installControlPointers, bindHoldButton } from '../viewer/control-pointers.mjs';

// A small target model that implements the event behavior relevant to this
// controller: capture-before-bubble ordering, immediate propagation stopping,
// preventDefault and pointer ownership. It is not a substitute for browser QA.
class FakeTarget {
  constructor() { this.listeners = new Map(); this.style = {}; this.captures = new Set(); this.captureLog = []; }
  addEventListener(type, callback, options = false) {
    const capture = typeof options === 'boolean' ? options : Boolean(options.capture);
    const list = this.listeners.get(type) || [];
    list.push({ callback, capture }); this.listeners.set(type, list);
  }
  emit(type, data = {}) {
    const event = { type, target: this, button: 0, pointerId: 1, clientX: 10, clientY: 20,
      defaultPrevented: false, immediateStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.immediateStopped = true; }, ...data };
    for (const { callback } of [...(this.listeners.get(type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture))) {
      callback(event); if (event.immediateStopped) break;
    }
    return event;
  }
  setPointerCapture(id) { this.captures.add(id); this.captureLog.push(['set', id]); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) {
    if (!this.captures.delete(id)) throw new Error(`Pointer ${id} was not captured`);
    this.captureLog.push(['release', id]);
    // Immediate dispatch deliberately stresses idempotence against a reentrant
    // lostpointercapture. Browsers may deliver this after pointer-up instead.
    this.emit('lostpointercapture', { pointerId: id });
  }
}

const controls = {
  'CTL-03': { label: 'Play' },
  'CTL-05': { label: 'Left volume', drag: true },
  'CTL-07': { label: 'Hot Line', hold: true },
  'CTL-08': { label: 'Tone', drag: true, toggle: true },
};
function harness(options = {}) {
  const canvas = new FakeTarget(), actions = [], inspected = [], hints = [], orbitEvents = [], orbitChanges = [];
  canvas.ownerDocument = new FakeTarget();
  let orbit = true, active = options.enabled ?? true, axis = options.axis ?? [{ x: 0, y: 100 }, { x: 0, y: 0 }];
  let currentValue = options.value ?? .5;
  // Simulate OrbitControls' existing bubble listeners. The control handlers are
  // installed after these and still must run first because they use capture.
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) canvas.addEventListener(type, event => {
    if (orbit) orbitEvents.push([type, event.pointerId]);
  });
  const api = installControlPointers({
    canvas, hitTest: event => event.hit === undefined ? { partId: options.partId ?? 'CTL-03' } : event.hit,
    describe: id => controls[id] || null, enabled: () => active, value: () => currentValue,
    projectedAxis: () => axis,
    activate: (...args) => { actions.push(args); if (args[1] === 'drag') currentValue = args[2]; },
    inspect: id => inspected.push(id), hint: text => hints.push(text),
    setOrbitEnabled: enabled => { orbit = enabled; orbitChanges.push(enabled); },
  });
  return { canvas, api, actions, inspected, hints, orbitEvents, orbitChanges,
    set enabled(value) { active = value; }, set axis(value) { axis = value; }, get orbit() { return orbit; } };
}

const checks = [], failures = [];
function check(name, run) {
  try { run(); checks.push(name); }
  catch (error) { failures.push({ name, message: error.message }); }
}
const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

check('A primary control captures its pointer, excludes orbit, clicks once and releases capture', () => {
  const h = harness(), down = h.canvas.emit('pointerdown');
  assert.equal(down.defaultPrevented, true); assert.equal(down.immediateStopped, true);
  assert.equal(h.orbit, false); assert.equal(h.canvas.hasPointerCapture(1), true);
  h.canvas.emit('pointerup', { clientX: 12 });
  assert.deepEqual(h.actions, [['CTL-03', 'click']]); assert.equal(h.orbit, true);
  assert.deepEqual(h.canvas.captureLog, [['set', 1], ['release', 1]]);
  assert.deepEqual(h.orbitEvents, []); assert.equal(h.hints.at(-1), '');
  h.canvas.emit('pointerup'); h.api.cancel(); assert.equal(h.actions.length, 1);
});
check('A moved button gesture does not click, and unrelated pointer-up does not release it', () => {
  const h = harness(); h.canvas.emit('pointerdown');
  h.canvas.emit('pointerup', { pointerId: 77 }); assert.equal(h.canvas.hasPointerCapture(1), true);
  h.canvas.emit('pointermove', { clientX: 100 }); h.canvas.emit('pointerup', { clientX: 100 });
  assert.deepEqual(h.actions, []); assert.deepEqual(h.inspected, []); assert.equal(h.orbit, true);
});
check('Right-button input does not start a physical control gesture', () => {
  const h = harness(); const event = h.canvas.emit('pointerdown', { button: 2 });
  assert.equal(event.defaultPrevented, false); assert.equal(h.orbit, true);
  assert.equal(h.canvas.captures.size, 0); h.canvas.emit('pointerup', { button: 2 }); assert.deepEqual(h.actions, []);
});
check('Inspection and empty surfaces retain orbit; inspection clicks do not operate a control', () => {
  const h = harness({ enabled: false }); h.canvas.emit('pointerdown'); h.canvas.emit('pointerup');
  assert.deepEqual(h.inspected, ['CTL-03']); assert.deepEqual(h.actions, []);
  assert.deepEqual(h.orbitEvents, [['pointerdown', 1], ['pointerup', 1]]);
  const empty = harness(); empty.canvas.emit('pointerdown', { hit: null }); empty.canvas.emit('pointermove', { clientX: 70 }); empty.canvas.emit('pointerup', { clientX: 70 });
  assert.deepEqual(empty.actions, []); assert.deepEqual(empty.inspected, []); assert.equal(empty.orbitEvents.length, 3);
  const body = harness({ partId: 'EXT-010' }); body.canvas.emit('pointerdown'); body.canvas.emit('pointerup');
  assert.deepEqual(body.inspected, ['EXT-010']); assert.deepEqual(body.actions, []);
});
check('Dragging uses the initial value and stable projected axis rather than accumulating deltas', () => {
  const h = harness({ partId: 'CTL-05' }); h.canvas.emit('pointerdown');
  h.canvas.emit('pointermove', { clientY: -5 }); approx(h.actions.at(-1)[2], .75);
  // A re-render may project the model differently; this gesture keeps its
  // original axis and original value, preventing feedback acceleration.
  h.axis = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  h.canvas.emit('pointermove', { clientY: -20 }); approx(h.actions.at(-1)[2], .9);
  h.canvas.emit('pointermove', { clientY: 1000 }); approx(h.actions.at(-1)[2], 0);
  h.canvas.emit('pointermove', { clientY: -1000 }); approx(h.actions.at(-1)[2], 1);
  h.canvas.emit('pointerup', { clientY: -1000 }); assert.equal(h.actions.some(action => action[1] === 'click'), false);
  assert.deepEqual(h.orbitEvents, []); assert.equal(h.orbit, true);
});
check('Drag projection follows reversed and horizontal model axes; end-on axes do not change values', () => {
  for (const [axis, move, expected] of [
    [[{ x: 0, y: 0 }, { x: 0, y: 100 }], { clientY: -5 }, .25],
    [[{ x: 0, y: 0 }, { x: 100, y: 0 }], { clientX: 35 }, .75],
  ]) {
    const h = harness({ partId: 'CTL-05', axis }); h.canvas.emit('pointerdown'); h.canvas.emit('pointermove', move);
    approx(h.actions.at(-1)[2], expected); h.api.cancel();
  }
  const endOn = harness({ partId: 'CTL-05', axis: [{ x: 0, y: 0 }, { x: 1, y: 0 }] });
  endOn.canvas.emit('pointerdown'); endOn.canvas.emit('pointermove', { clientX: 99 }); assert.deepEqual(endOn.actions, []); endOn.api.cancel();
});
check('Tone clicks toggle while volume clicks do not; a moved Tone gesture only drags', () => {
  const tone = harness({ partId: 'CTL-08' }); tone.canvas.emit('pointerdown'); tone.canvas.emit('pointerup');
  assert.deepEqual(tone.actions, [['CTL-08', 'click']]);
  const volume = harness({ partId: 'CTL-05' }); volume.canvas.emit('pointerdown'); volume.canvas.emit('pointerup'); assert.deepEqual(volume.actions, []);
  const drag = harness({ partId: 'CTL-08' }); drag.canvas.emit('pointerdown'); drag.canvas.emit('pointermove', { clientY: -40 }); drag.canvas.emit('pointerup', { clientY: -40 });
  assert.equal(drag.actions.length, 1); assert.equal(drag.actions[0][1], 'drag');
});
check('A held Hot Line releases outside the canvas without click, with exactly one release', () => {
  const h = harness({ partId: 'CTL-07' }); h.canvas.emit('pointerdown');
  assert.deepEqual(h.actions, [['CTL-07', 'press']]);
  h.canvas.emit('pointerleave'); assert.equal(h.orbit, false);
  // Pointer capture routes the release back to this canvas even outside bounds.
  h.canvas.emit('pointerup', { clientX: -500, clientY: 1000 });
  assert.deepEqual(h.actions, [['CTL-07', 'press'], ['CTL-07', 'release']]); assert.equal(h.orbit, true);
});
check('Pointer cancellation, lost capture and external blur/hidden cancellation release Hot Line once', () => {
  for (const event of ['pointercancel', 'lostpointercapture', 'external-cancel']) {
    const h = harness({ partId: 'CTL-07' }); h.canvas.emit('pointerdown');
    if (event === 'external-cancel') h.api.cancel(); else h.canvas.emit(event);
    assert.deepEqual(h.orbitEvents, [], 'A control cancellation cannot be delivered as an Orbit cancellation');
    h.api.cancel(); h.canvas.emit('pointerup');
    assert.deepEqual(h.actions, [['CTL-07', 'press'], ['CTL-07', 'release']], event);
    assert.equal(h.orbit, true); assert.equal(h.canvas.captures.size, 0);
  }
});
check('A second pointer cancels the owned control before handing the gesture back to orbit', () => {
  for (const partId of ['CTL-07', 'CTL-05']) {
    const h = harness({ partId }); h.canvas.emit('pointerdown'); h.canvas.emit('pointerdown', { pointerId: 2 });
    assert.equal(h.orbit, true, `${partId}: second pointer should restore orbit`);
    // Retaining the old capture lets the controller swallow stale moves/up,
    // while the new pointer begins a valid fresh orbit gesture.
    assert.equal(h.canvas.hasPointerCapture(1), true);
    if (partId === 'CTL-07') assert.deepEqual(h.actions, [['CTL-07', 'press'], ['CTL-07', 'release']]);
    h.canvas.emit('pointermove', { pointerId: 1, clientX: 99 });
    h.canvas.emit('pointermove', { pointerId: 2, clientX: 99 });
    h.canvas.emit('pointerup', { pointerId: 1 }); h.canvas.emit('pointerup', { pointerId: 2 });
    assert.equal(h.canvas.hasPointerCapture(1), false);
    assert.deepEqual(h.orbitEvents, [['pointerdown', 2], ['pointermove', 2], ['pointerup', 2]], 'The old control pointer never enters the new orbit gesture');
    assert.equal(h.actions.some(action => action[1] === 'click'), false);
  }
});
check('Starting an ordinary two-pointer orbit cancels pending inspection without stealing its capture', () => {
  const h = harness({ enabled: false }); h.canvas.emit('pointerdown');
  // A real OrbitControls listener owns this capture; the control helper must
  // not release it merely because it recorded a possible inspection click.
  h.canvas.setPointerCapture(1); h.canvas.emit('pointerdown', { pointerId: 2 });
  assert.equal(h.canvas.hasPointerCapture(1), true);
  h.canvas.emit('pointerup'); h.canvas.emit('pointerup', { pointerId: 2 });
  assert.deepEqual(h.inspected, []); assert.deepEqual(h.actions, []);
  assert.deepEqual(h.orbitEvents, [['pointerdown', 1], ['pointerdown', 2], ['pointerup', 1], ['pointerup', 2]]);
});
check('Further pointers continue the current camera gesture and controls become available after every pointer lifts', () => {
  const h = harness({ partId: 'CTL-07' }); h.canvas.emit('pointerdown');
  h.canvas.emit('pointerdown', { pointerId: 2 });
  h.canvas.emit('pointerup', { pointerId: 1 });
  h.canvas.emit('pointerdown', { pointerId: 3 });
  assert.deepEqual(h.actions, [['CTL-07', 'press'], ['CTL-07', 'release']]);
  assert.equal(h.orbit, true, 'Third finger continues orbit instead of pressing Hot Line');
  h.canvas.emit('pointerup', { pointerId: 2 }); h.canvas.emit('pointerup', { pointerId: 3 });
  h.canvas.emit('pointerdown', { pointerId: 4 }); h.canvas.emit('pointerup', { pointerId: 4 });
  assert.deepEqual(h.actions, [['CTL-07', 'press'], ['CTL-07', 'release'], ['CTL-07', 'press'], ['CTL-07', 'release']]);
});
check('Outside-canvas pinch endings and external blur reset cannot leave stale orbit ownership', () => {
  for (const ending of ['pointerup', 'pointercancel', 'external-cancel']) {
    const h = harness({ partId: 'CTL-07' }); h.canvas.emit('pointerdown', { hit: null });
    h.canvas.emit('pointerdown', { pointerId: 2 });
    h.canvas.emit('pointerup', { pointerId: 1 });
    if (ending === 'external-cancel') h.api.cancel();
    else h.canvas.ownerDocument.emit(ending, { pointerId: 2, target: new FakeTarget() });
    h.canvas.emit('pointerdown', { pointerId: 3 }); h.canvas.emit('pointerup', { pointerId: 3 });
    assert.deepEqual(h.actions, [['CTL-07', 'press'], ['CTL-07', 'release']], ending);
  }
});
check('Cancellation belonging to a different pointer cannot release the active held control', () => {
  const h = harness({ partId: 'CTL-07' }); h.canvas.emit('pointerdown');
  h.canvas.emit('pointercancel', { pointerId: 2 }); h.canvas.emit('lostpointercapture', { pointerId: 2 });
  assert.deepEqual(h.actions, [['CTL-07', 'press']]); assert.equal(h.orbit, false);
  h.canvas.emit('pointerup'); assert.deepEqual(h.actions, [['CTL-07', 'press'], ['CTL-07', 'release']]);
});
check('Hover identifies controls and clears the hint on leaving without starting a gesture', () => {
  const h = harness({ partId: 'CTL-05' }); h.canvas.emit('pointermove');
  assert.equal(h.canvas.style.cursor, 'ns-resize'); assert.match(h.hints.at(-1), /drag/);
  h.canvas.emit('pointerleave'); assert.equal(h.hints.at(-1), '');
  h.enabled = false; h.canvas.emit('pointermove'); assert.equal(h.canvas.style.cursor, 'grab'); assert.equal(h.hints.at(-1), '');
  assert.deepEqual(h.actions, []);
});
check('The accessible hold button captures primary pointers and clears each hold on release or interruption', () => {
  for (const end of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur', 'external-cancel']) {
    const button = new FakeTarget(), active = [], api = bindHoldButton(button, value => active.push(value));
    button.emit('pointerdown', { button: 2 }); assert.deepEqual(active, []);
    const event = button.emit('pointerdown'); assert.equal(event.defaultPrevented, true); assert.equal(button.hasPointerCapture(1), true);
    button.emit('pointerdown'); assert.deepEqual(active, [true], 'Duplicate down must not retrigger');
    if (end === 'external-cancel') api.cancel(); else button.emit(end);
    api.cancel(); button.emit('pointerup'); assert.deepEqual(active, [true, false], end);
  }
});
check('Space/Enter hold the accessible button without key-repeat toggles and blur releases a lost keyup', () => {
  for (const code of ['Space', 'Enter']) {
    const button = new FakeTarget(), active = []; bindHoldButton(button, value => active.push(value));
    button.emit('keydown', { code: 'ArrowDown' }); assert.deepEqual(active, []);
    const event = button.emit('keydown', { code }); assert.equal(event.defaultPrevented, true);
    button.emit('keydown', { code, repeat: true }); assert.deepEqual(active, [true]);
    button.emit('keyup', { code }); assert.deepEqual(active, [true, false]);
    button.emit('keydown', { code }); button.emit('blur'); button.emit('keyup', { code });
    assert.deepEqual(active, [true, false, true, false]);
  }
});

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = {};
for (const path of ['viewer/control-pointers.mjs', 'tests/test_control_pointers.mjs']) sourceHashes[path] = hash(await readFile(new URL(`../${path}`, import.meta.url)));
const report = {
  schemaVersion: 1, passed: failures.length === 0, generatedAt: new Date().toISOString(), sourceHashes, checks, failures,
  scope: 'Fake target/canvas event tests for capture routing, propagation, pointer identity, projected drag, selection, momentary release, and accessible keyboard holds. External blur/visibility reset calls cancel(); browser integration must wire those events.',
  limitations: ['Does not certify a real browser event dispatcher or hardware pointer capture.', 'Does not certify touch/pinch behavior on a real phone, real keyboard focus navigation, rendered geometry picking, or audible output.'],
};
await writeFile(new URL('../build/test-results/control-pointers-tests.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(`${report.passed ? 'PASS' : 'FAIL'}: ${checks.length} pointer-control groups passed; ${failures.length} failed`);
for (const failure of failures) console.error(`${failure.name}: ${failure.message}`);
if (failures.length) process.exitCode = 1;
