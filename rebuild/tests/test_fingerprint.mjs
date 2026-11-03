// Part fingerprints (tools/compare.mjs, format 2): a shape is its decoded values, so a 16-bit mesh whose
// scale or offset changes is a new shape, while the same values packed differently are the same shape.
// Poses, travel and packing are kept apart, and records in an older format are never compared part by part.
import './test_setup.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fingerprint, fingerprintView, describeChanges, readView, meshContent, FINGERPRINT_FORMAT} from '../tools/compare.mjs';

const copy = v => JSON.parse(JSON.stringify(v));
const VIEW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../view');

// A made-up page: RAIL is a 16-bit mesh (a box), PIN plain float32, TAPE the generated cassette's only part.
function page({q = [0, 0, 0, 1000, 0, 0, 0, 2000, 0, 0, 0, 3000], pscale = [0.01, 0.01, 0.01], pmin = [-5, 0, 2], index = 'u16', order = 'pni', indices = [0, 1, 2, 0, 2, 3], shift = 0, poses = {stop: [0, 0, 0]}, target = [0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]} = {}) {
  const chunks = {}, n = [0, 0, 32767, 0, 0, 32767, 0, 0, 32767, 0, 0, 32767];
  chunks.p = Buffer.from(Uint16Array.from(q).buffer); chunks.n = Buffer.from(Int16Array.from(n).buffer);
  chunks.i = Buffer.from((index === 'u16' ? Uint16Array : Uint32Array).from(indices).buffer);
  const pieces = [Buffer.alloc(shift)], at = {};
  for (const key of order) { at[key] = pieces.reduce((s, b) => s + b.length, 0); pieces.push(chunks[key]); }
  const pinAt = pieces.reduce((s, b) => s + b.length, 0), pin = Buffer.from(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 2]).buffer);
  const buffer = Buffer.concat([...pieces, pin]);
  const rail = {id: 'RAIL', package: 'mechanism', poses, meshes: [{m: 0, p: [at.p, 12], n: [at.n, 12], i: [at.i, 6], pscale, pmin, indexType: index,
    deformation: {targets: [{name: 'k', positions: target}]}}]};
  const pinPart = {id: 'PIN', package: 'mechanism', poses: {stop: [1, 0, 0]}, meshes: [{m: 1, p: [pinAt, 9], n: [pinAt + 36, 9], i: [pinAt + 72, 3], indexType: 'u32'}]};
  // PIN's indices are float32 0,1,2 reinterpreted below as uint32; keep them valid by writing them as integers.
  buffer.writeUInt32LE(0, pinAt + 72); buffer.writeUInt32LE(1, pinAt + 76); buffer.writeUInt32LE(2, pinAt + 80);
  const tape = {id: 'TAPE', poses: {stop: [0, 0, 0]}, meshes: [{m: 0, p: [pinAt, 9], n: [pinAt + 36, 9], i: [pinAt + 72, 3], indexType: 'u32'}]};
  return {meta: {materials: [{name: 'steel'}, {name: 'brass'}], parts: [rail, pinPart], alternatives: {cassette: {parts: [tape], materials: [{name: 'clear'}]}}},
    packages: {mechanism: buffer, cassette: buffer}, pageMotion: {controls: {}}};
}
const base = fingerprint(page());
assert.equal(base.format, FINGERPRINT_FORMAT, 'records say which format they use');
assert.deepEqual(fingerprint(page()), base, 'the same page gives the same fingerprints');

// Scale only: the stored 16-bit steps are the same, the millimetres are not (the BAY-073 case).
const scaled = fingerprint(page({pscale: [0.01, 0.01, 0.0075]}));
assert.notEqual(scaled.parts.RAIL.shape, base.parts.RAIL.shape, 'a new scale is a new shape');
assert.equal(scaled.parts.RAIL.poses, base.parts.RAIL.poses); assert.equal(scaled.parts.RAIL.other, base.parts.RAIL.other);
assert.match(describeChanges(base, scaled).join('\n'), /^RAIL: shape, size 10 × 20 × 30 → 10 × 20 × 22\.5 mm$/m, 'the report names the resize');

// Offset only: the same size, moved within the part.
const shifted = fingerprint(page({pmin: [-5, 0, 2.5]}));
assert.notEqual(shifted.parts.RAIL.shape, base.parts.RAIL.shape, 'a new offset is a new shape');
assert.deepEqual(describeChanges(base, shifted), ['RAIL: shape, same overall size']);

// Pose only: shape untouched, placement changed.
const moved = fingerprint(page({poses: {stop: [0, 1, 0]}}));
assert.equal(moved.parts.RAIL.shape, base.parts.RAIL.shape); assert.notEqual(moved.parts.RAIL.poses, base.parts.RAIL.poses);
assert.deepEqual(describeChanges(base, moved), ['RAIL: positions in one or more modes']);

// The same values packed differently: half the steps at twice the scale, 32-bit indices, other offsets and order.
const repacked = fingerprint(page({q: [0, 0, 0, 500, 0, 0, 0, 1000, 0, 0, 0, 1500], pscale: [0.02, 0.02, 0.02], index: 'u32', order: 'ipn', shift: 16}));
assert.deepEqual(repacked, base, 'repacking the same values changes no fingerprint');
assert.deepEqual(describeChanges(base, repacked), []);

// Real changes to topology and to a shape key.
assert.notEqual(fingerprint(page({indices: [0, 2, 1, 0, 2, 3]})).parts.RAIL.shape, base.parts.RAIL.shape, 'turning a triangle over is a change');
assert.notEqual(fingerprint(page({target: [0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.001]})).parts.RAIL.shape, base.parts.RAIL.shape, 'a shape-key offset is part of the shape');

// Values that cannot be fingerprinted, and -0.
assert.throws(() => meshContent({positions: [0, NaN, 0], normals: [], indices: [], targets: []}), /not a finite number/);
assert.equal(meshContent({positions: [-0, 1, 2], normals: [], indices: [], targets: []}), meshContent({positions: [0, 1, 2], normals: [], indices: [], targets: []}));

// A record in the older format is never compared part by part, so its matching hashes cannot pass for an unchanged model.
const old = copy(base); delete old.format;
assert.deepEqual(describeChanges(old, base).length, 1); assert.match(describeChanges(old, base)[0], /format 1 cannot be compared with format 2/);

// The shipped page: every part, every exterior state and the generated cassette, the same twice over;
// and the real rail BAY-073 (once cut from 6.05 to 4.55 mm without its 16-bit steps changing),
// taken back to 6.05 mm by its scale alone, is reported as a new shape and size.
const view = await readView(VIEW), real = fingerprint(view);
assert.equal(real.format, FINGERPRINT_FORMAT);
assert(Object.keys(real.parts).some(k => k.startsWith('exterior ')) && Object.keys(real.parts).some(k => k.startsWith('cassette alternative ')));
assert.deepEqual((await fingerprintView(VIEW)).parts, real.parts, 'fingerprints are repeatable');
const rail = view.meta.parts.find(p => p.id === 'BAY-073').meshes[0], axis = real.parts['BAY-073'].size_mm.indexOf(4.55);
assert(axis >= 0, 'BAY-073 is 4.55 mm tall in the shipped model');
const grown = {...view, meta: {...view.meta, parts: view.meta.parts.map(p => p.id !== 'BAY-073' ? p : {...p, meshes: [{...rail, pscale: rail.pscale.map((s, i) => i === axis ? s * 6.05 / 4.55 : s)}]})}};
const after = fingerprint(grown);
assert.notEqual(after.parts['BAY-073'].shape, real.parts['BAY-073'].shape);
assert.match(describeChanges(real, after).join('\n'), /BAY-073: shape, size 63\.6 × 2\.6 × 4\.55 → 63\.6 × 2\.6 × 6\.05 mm/);
console.log('fingerprint format 2: scale, offset, pose, repacking, topology, shape keys, old records and the BAY-073 cut behave as intended');
