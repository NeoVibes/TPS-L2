// needs-parts: CTL-01 CTL-02 CTL-03 CTL-04 CTL-05 CTL-06 CTL-07 CTL-08
// (This test is about these particular controls. "npm test" leaves it out when the model no longer has one of them.)
import './test_setup.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CONTROL_BINDINGS, MODEL_CONTROLS, actionForControl, controlVisualOffset, controlValue, projectedDragValue, pickModelControl } from '../viewer/model-controls.mjs';
import { createOperatingState, dispatchOperating, advanceOperating } from '../viewer/operating-state.mjs';

const read = async path => readFile(new URL(path, import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const modelBytes = await read('../build/exports/model-packed.json');
const model = JSON.parse(modelBytes), ids = new Set(model.parts.map(part => part.id));
const motion=JSON.parse(await read('../build/exports/motion.json'));
const checks = [];
function check(name, run) { run(); checks.push(name); }
const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

check('Every clickable or moving owner exists in the current authoritative export', () => {
  for (const [partId, descriptor] of Object.entries(CONTROL_BINDINGS)) {
    assert.ok(ids.has(partId), partId);
    assert.ok(Object.isFrozen(descriptor));
  }
  for (const control of MODEL_CONTROLS) for (const id of control.motionPartIds || []) assert.ok(ids.has(id), id);
  assert.equal(actionForControl('CTL-99'), null);
  assert.equal(actionForControl('GRL-717'), null, 'Fixed scales are not moving controls');
  assert.equal(actionForControl('BCL-020'), null, 'Fixed retaining plate is not the catch');
});
check('Physical transport actions use the same reducer with independent cover operation', () => {
  const state = createOperatingState();
  for (const [partId, mode] of [['CTL-03', 'play'], ['CTL-01', 'ff'], ['CTL-02', 'rew']]) {
    dispatchOperating(state, actionForControl(partId, state)); assert.equal(state.mode, mode);
  }
  dispatchOperating(state, actionForControl('CTL-04', state)); assert.equal(state.mode, 'rew');
  advanceOperating(state,2); assert.equal(state.mode, 'stop');
  dispatchOperating(state, actionForControl('CTL-04', state)); advanceOperating(state,2);
  assert.equal(state.door, false); assert.equal(state.ejectNeedsOpenCover,true);
  dispatchOperating(state, actionForControl('EXT-031', state)); assert.equal(state.door,true);
  dispatchOperating(state, actionForControl('CTL-04', state)); advanceOperating(state,2); assert.equal(state.media,'ejected');
  dispatchOperating(state, actionForControl('CTL-03', state)); assert.equal(state.mode, 'play');
  dispatchOperating(state, actionForControl('EXT-031', state)); assert.equal(state.door, false);
});
check('Hot Line is explicitly held and releases on every interruption; clicking cannot latch it', () => {
  const state = createOperatingState();
  for (const phase of ['release', 'cancel', 'blur', 'hidden']) {
    dispatchOperating(state, actionForControl('CTL-07', state, 'press')); assert.equal(state.hotline, true);
    dispatchOperating(state, actionForControl('CTL-07', state, phase)); assert.equal(state.hotline, false);
  }
  assert.equal(actionForControl('CTL-07', state, 'click'), null);
});
check('Independent volume and Tone actions clamp valid values and ignore invalid drag input', () => {
  const state = createOperatingState({ volumeLeft: .5, volumeRight: .5 });
  dispatchOperating(state, actionForControl('CTL-05', state, 'drag', 2));
  assert.equal(state.volumeLeft, 1); assert.equal(state.volumeRight, .5);
  dispatchOperating(state, actionForControl('CTL-06', state, 'drag', -1)); assert.equal(state.volumeRight, 0);
  assert.equal(actionForControl('CTL-05', state, 'drag', NaN), null);
  dispatchOperating(state, actionForControl('CTL-08', state)); assert.equal(state.tone, 'low');
  dispatchOperating(state, actionForControl('CTL-08', state, 'drag', .9)); assert.equal(state.tone, 'high');
});
check('Moving owners follow generated native tracks; unbound owners stay fixed', () => {
  for(const control of MODEL_CONTROLS)for(const id of control.motionPartIds||[]){
   const native=motion.controls[control.id],track=native.parts[id];
   assert(track,id);
   for(const value of [0,.25,.5,.75,1]){
    // Tone's user control has two detents; the native dense curve is tested separately.
    if(control.id==='tone'&&value!==0&&value!==1)continue;
    if(control.id==='hotline'&&value!==0&&value!==1)continue;
    const state=control.kind==='slider'?{[control.stateKey]:value}:control.id==='tone'?{tone:value?'high':'low',toneTouched:true}:{hotline:!!value};
    const sample=track.samples.find(s=>s.value===value);assert(sample);
    const delta=controlVisualOffset(id,state);
    for(let i=0;i<3;i++)approx(delta[i],sample.position[i]-track.restPosition[i]);
   }
  }
  for(const id of ['GRL-717','EXT-050','CTL-03'])assert.deepEqual(controlVisualOffset(id,{volumeLeft:1,tone:'low',mode:'play'}),[0,0,0]);
  assert.deepEqual(controlVisualOffset('CTL-08',{tone:'high',toneTouched:false}),[0,0,0]);
  assert.equal(controlValue('CTL-08',{tone:'low'}),0);
});
check('Projected slider drag respects rotated/inverted camera axes, clamps, and ignores end-on axes', () => {
  const base = { startValue: .5, start: [10, 10], current: [10, -15], axisStart: [0, 100], axisEnd: [0, 0] };
  approx(projectedDragValue(base), .75);
  approx(projectedDragValue({ ...base, axisStart: [0, 0], axisEnd: [0, 100] }), .25);
  approx(projectedDragValue({ ...base, current: [35, 10], axisStart: [0, 0], axisEnd: [100, 0] }), .75);
  approx(projectedDragValue({ ...base, current: [10, -1000] }), 1);
  approx(projectedDragValue({ ...base, axisEnd: [0, 99] }), .5);
  approx(projectedDragValue({ ...base, current: [NaN, 0] }), .5);
  approx(projectedDragValue({ startValue: .8 }), .8);
});
check('Nearest visible surface controls picking; casing blocks behind it and clipping removes only clipped hits', () => {
  const casing = { distance: 1, partId: 'EXT-010', object: { visible: true } };
  const play = { distance: 2, object: { visible: true, parent: { userData: { part: { data: { id: 'CTL-03' } } } } } };
  assert.equal(pickModelControl([play, casing]), null);
  assert.equal(pickModelControl([play, casing], { acceptsHit: h => h !== casing }).partId, 'CTL-03');
  casing.object.parent = { visible: false };
  assert.equal(pickModelControl([play, casing]).partId, 'CTL-03');
  assert.equal(pickModelControl([play], { allowsControl: () => false }), null);
  assert.equal(pickModelControl([{ distance: -1, partId: 'CTL-03' }]), null);
});
check('Battery cover and catch remain separate presentation actions', () => {
  assert.deepEqual(actionForControl('EXT-040'), { type: 'battery-door' });
  assert.deepEqual(actionForControl('EXT-041'), { type: 'battery-door' });
  assert.deepEqual(actionForControl('BCL-010'), { type: 'battery-latch' });
  assert.deepEqual(controlVisualOffset('BCL-020'), [0, 0, 0]);
});

const sourceHashes = {};
for (const path of ['viewer/model-controls.mjs', 'viewer/operating-state.mjs', 'tests/test_model_controls.mjs']) sourceHashes[path] = hash(await read(`../${path}`));
const report = { schemaVersion: 1, passed: true, generatedAt: new Date().toISOString(), nativeSha256: model.source_sha256, sourceHashes, inputHashes: { 'build/exports/model-packed.json': hash(modelBytes) }, checks, scope: 'Pure control mapping, projected drag and occlusion policy tests. Does not certify browser pointer capture, physical fit, audio hardware, or real phone gestures.' };
await writeFile(new URL('../build/test-results/model-controls-tests.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(`PASS: ${checks.length} physical-control helper checks`);
