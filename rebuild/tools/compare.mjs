// Compares two kits by content: every part's shape, every pose, every motion sample.
//
//   node compare.mjs <reference kit> <candidate kit> [--report file.json]
//
// It reads what the page actually loads (the part list and the geometry files) and, when both
// kits have them, the build's working files. File names, folder layout, checksums and byte
// offsets are ignored; only the decoded content counts. Exit code 0 means equivalent.
import {readFile, writeFile, access} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {defaultExteriorMeta, exteriorStates} from '../viewer/exterior.mjs';

const exists = p => access(p).then(() => true, () => false);
const readJson = async p => JSON.parse(await readFile(p, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = bytes => sha256(bytes).slice(0, 16);

// Paths that may differ between kits without the model having changed. Each one is listed
// here on purpose; anything else that differs is reported.
const EXPECTED_TO_DIFFER = [
  /sha256$/i,                       // checksums follow file bytes, not content
  /^snapshot_ref$/,                 // an object's position in the Blender file's object list
  /^meta\.source$/,                 // where the Blender file sits in the kit
  /^meta\.config\.native$/,
  /^meta\.geometry_bytes$/,         // total size of the geometry buffer
];

// ---------- reading a kit ----------

function dataFilePayload(text, name) {
  // A geometry file is a script that calls portableTapePlayerLoaded(name, payload).
  const start = text.indexOf('(') + 1, comma = text.indexOf(',', start), end = text.lastIndexOf(')');
  if (JSON.parse(text.slice(start, comma)) !== name) throw new Error('Data file is not ' + name);
  return JSON.parse(text.slice(comma + 1, end));
}

/** Reads a view/ folder: the part list, the control ranges and every geometry file, unpacked. */
export async function readView(viewDir) {
  const view = {packages: {}};
  const model = dataFilePayload(await readFile(path.join(viewDir, 'geometry/model.js'), 'utf8'), 'model');
  view.meta = model.meta; view.pageMotion = model.motion; view.packageTable = model.packages; view.measured = model.measured || null;
  for (const [name, entry] of Object.entries(model.packages)) {
    const compressed = Buffer.from(dataFilePayload(await readFile(path.join(viewDir, 'geometry', entry.file), 'utf8'), name), 'base64');
    if (sha256(compressed) !== entry.sha256) throw new Error('geometry/' + entry.file + ' does not match the part list (wrong checksum)');
    view.packages[name] = gunzipSync(compressed);
  }
  return view;
}

async function readKit(dir) {
  const kit = {dir, packages: {}, ...await readView(path.join(dir, 'view')), work: path.join(dir, 'rebuild/build/exports')};
  if (!(await exists(path.join(kit.work, 'model.json')))) kit.work = null;   // a download has no working files; only what the page loads is compared
  return kit;
}

// ---------- decoding geometry ----------

const TYPES = {u16: [Uint16Array, 2], i16: [Int16Array, 2], u32: [Uint32Array, 4], f32: [Float32Array, 4]};
function array(buffer, [offset, count], type) {
  const [Type, size] = TYPES[type];
  if (offset + count * size > buffer.length) throw new Error('Geometry range runs past the end of its file');
  return new Type(buffer.buffer.slice(buffer.byteOffset + offset, buffer.byteOffset + offset + count * size));
}

// One mesh as plain numbers: positions in mm, unit normals, triangle indices.
// Meshes with a scale ("pscale") are stored as 16-bit steps; the others as plain 32-bit floats.
function decodeMesh(mesh, buffer) {
  const out = {};
  const indexType = mesh.indexType === 'u16' ? 'u16' : 'u32';
  if (mesh.pscale) {
    const q = array(buffer, mesh.p, 'u16'), n = array(buffer, mesh.n, 'i16');
    out.positions = Float64Array.from(q, (v, i) => v * mesh.pscale[i % 3] + mesh.pmin[i % 3]);
    out.normals = Float64Array.from(n, v => v / 32767);
    out.indices = array(buffer, mesh.i, indexType);
    out.exact = [q, n, out.indices];
  } else {
    out.positions = array(buffer, mesh.p, 'f32'); out.normals = array(buffer, mesh.n, 'f32');
    out.indices = array(buffer, mesh.i, indexType);
    out.exact = [out.positions, out.normals, out.indices];
  }
  if (mesh.beltS) { out.beltS = array(buffer, mesh.beltS, 'f32'); out.exact.push(out.beltS); }
  out.targets = (mesh.deformation?.targets || []).map(t =>
    Array.isArray(t.positions) && t.encoding === 'float32' ? array(buffer, t.positions, 'f32') : Float32Array.from(t.positions));
  out.exact.push(...out.targets);
  return out;
}

// The part list with byte offsets replaced by fingerprints of the decoded content, so two kits
// that pack the same geometry differently still compare equal.
function describeParts(parts, bufferFor) {
  const described = {}, decoded = {};
  for (const part of parts) {
    const meshes = part.meshes.map(mesh => decodeMesh(mesh, bufferFor(part)));
    decoded[part.id] = meshes;
    described[part.id] = {...part, meshes: part.meshes.map((mesh, k) => {
      const {p, n, i, beltS, ...rest} = mesh;
      if (rest.deformation) rest.deformation = {...rest.deformation, targets: rest.deformation.targets.map(({positions, encoding, ...t}) => t)};
      return {...rest, vertices: meshes[k].positions.length / 3, triangles: meshes[k].indices.length / 3,
        content: meshes[k].exact.map(a => sha(Buffer.from(a.buffer, a.byteOffset, a.byteLength)))};
    })};
  }
  return {described, decoded};
}

// ---------- comparing ----------

// Lists in the working files that describe the Blender file itself: which helper objects exist and
// how rig objects depend on one another. Order and numbering follow the file's object list.
const RECORD_LISTS = {inventory: ['helper_geometry'], motion: ['native_dependencies', 'native_constraints', 'native_parenting']};
const withoutRefs = o => Array.isArray(o) ? o.map(withoutRefs) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'snapshot_ref').map(([k, v]) => [k, withoutRefs(v)])) : o;
function compareRecordList(before, after, where) {
  const count = list => { const m = new Map(); for (const r of list) { const k = JSON.stringify(withoutRefs(r)); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const a = count(before), b = count(after);
  for (const [record, n] of b) if ((a.get(record) || 0) < n) note(where, 'new record: ' + record.slice(0, 100));
  for (const [record, n] of a) if ((b.get(record) || 0) < n) note(where, 'record gone: ' + record.slice(0, 100));
}

const differences = [];
const note = (where, what) => { if (differences.length < 400) differences.push({where, what}); else differences.overflow = true; };
const expected = where => EXPECTED_TO_DIFFER.some(rule => rule.test(where) || rule.test(where.split('.').pop()));

function deepCompare(a, b, where) {
  if (expected(where)) return;
  if (a === b) return;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object' || Array.isArray(a) !== Array.isArray(b))
    return note(where, JSON.stringify(a)?.slice(0, 80) + ' → ' + JSON.stringify(b)?.slice(0, 80));
  if (Array.isArray(a) && a.length !== b.length) return note(where, 'length ' + a.length + ' → ' + b.length);
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(key in a)) { if (!expected(where + '.' + key)) note(where + '.' + key, 'added'); continue; }
    if (!(key in b)) { if (!expected(where + '.' + key)) note(where + '.' + key, 'removed'); continue; }
    deepCompare(a[key], b[key], where + '.' + key);
  }
}

// How far a part's geometry moved, for the report. Only called for parts already known to differ.
function geometryChange(a, b) {
  const change = {position_mm: 0, normal_deg: 0, topology: false};
  if (a.length !== b.length) return {...change, topology: true};
  for (let k = 0; k < a.length; k++) {
    const A = a[k], B = b[k];
    if (A.positions.length !== B.positions.length || A.indices.length !== B.indices.length) { change.topology = true; continue; }
    for (let i = 0; i < A.indices.length; i++) if (A.indices[i] !== B.indices[i]) { change.topology = true; break; }
    for (let i = 0; i < A.positions.length; i++) change.position_mm = Math.max(change.position_mm, Math.abs(A.positions[i] - B.positions[i]));
    for (let i = 0; i < A.normals.length; i += 3) {
      const dot = A.normals[i] * B.normals[i] + A.normals[i + 1] * B.normals[i + 1] + A.normals[i + 2] * B.normals[i + 2];
      const len = Math.hypot(A.normals[i], A.normals[i + 1], A.normals[i + 2]) * Math.hypot(B.normals[i], B.normals[i + 1], B.normals[i + 2]);
      if (len > 0) change.normal_deg = Math.max(change.normal_deg, Math.acos(Math.min(1, Math.max(-1, dot / len))) * 180 / Math.PI);
    }
  }
  return change;
}

function compareParts(label, A, B) {
  const ids = new Set([...Object.keys(A.described), ...Object.keys(B.described)]), changed = {};
  for (const id of ids) {
    if (!A.described[id]) { note(label + '.' + id, 'part added'); continue; }
    if (!B.described[id]) { note(label + '.' + id, 'part removed'); continue; }
    const before = differences.length;
    deepCompare(A.described[id], B.described[id], label + '.' + id);
    if (differences.length > before && JSON.stringify(A.described[id].meshes.map(m => m.content)) !== JSON.stringify(B.described[id].meshes.map(m => m.content)))
      changed[id] = geometryChange(A.decoded[id], B.decoded[id]);
  }
  return changed;
}

/** The states of parts that other exterior versions show, as parts of their own named "exterior <versions> <part id>". */
export function exteriorStateParts(meta) {
  const strip = ({versions, piece, ...mesh}) => mesh;
  // A state also carries the materials of its own lettering, so that recolouring it counts as a change to that state.
  return meta.parts.flatMap(part => exteriorStates(part, meta.exterior).filter(s => !s.base).map(s => ({...part, id: 'exterior ' + s.name + ' ' + part.id,
    lettering_materials: s.meshes.filter(m => m.versions).map(m => meta.materials[m.m] ?? null), meshes: s.meshes.map(strip)})));
}

// Compares what two pages load. Fills `differences`; returns per-part geometry changes.
function comparePages(ref, cand, checked) {
  const pagePackage = kit => part => kit.packages[part.package];
  // Kits are compared as their default exterior version shows them. Lettering that only other versions show is listed separately.
  // Materials are compared by name: their numbers follow the order parts are exported in, so one edit can renumber them all.
  const named = meta => ({...meta, materials: Object.fromEntries((meta.materials ?? []).map(m => [m.name, m])), parts: meta.parts.map(p => ({...p, meshes: p.meshes.map(mesh => ({...mesh, m: meta.materials?.[mesh.m]?.name ?? mesh.m}))}))});
  const {parts: refParts, alternatives: refAlt, ...refRest} = named(defaultExteriorMeta(ref.meta)), {parts: candParts, alternatives: candAlt, ...candRest} = named(defaultExteriorMeta(cand.meta));
  deepCompare(refRest, candRest, 'meta');
  const geometry = compareParts('page.part', describeParts(refParts, pagePackage(ref)), describeParts(candParts, pagePackage(cand)));
  checked.push('page: ' + refParts.length + ' parts, their poses and geometry' + (cand.meta.exterior?.default ? ', as the ' + cand.meta.exterior.default + ' exterior shows them' : ''));
  const states = kit => describeParts(exteriorStateParts(kit.meta), pagePackage(kit));
  if (ref.meta.exterior?.default && cand.meta.exterior?.default) Object.assign(geometry, compareParts('page.exterior', states(ref), states(cand)));
  else if (cand.meta.exterior?.default) checked.push('new in the candidate: exterior versions ' + cand.meta.exterior.versions.join(', ') + ', with ' + exteriorStateParts(cand.meta).length + ' further states of ' + new Set(exteriorStateParts(cand.meta).map(p => p.id.split(' ').pop())).size + ' parts (not in the reference, so not compared)');

  // The generated cassette alternative: its own part list inside the page data, geometry in its own file.
  const cassette = kit => describeParts(kit.meta.alternatives.cassette.parts.map(p => ({...p, package: 'cassette'})), () => kit.packages.cassette);
  const {parts: _a, ...refAltRest} = refAlt.cassette, {parts: _b, ...candAltRest} = candAlt.cassette;
  deepCompare(refAltRest, candAltRest, 'meta.alternatives.cassette');
  Object.assign(geometry, compareParts('page.cassette', cassette(ref), cassette(cand)));
  checked.push('page: generated cassette, ' + refAlt.cassette.parts.length + ' parts');

  const stripPackage = ({url, file, element, bytes, rawBytes, sha256, ...rest}) => rest;   // sizes and checksums follow the content
  deepCompare(Object.fromEntries(Object.entries(ref.packageTable).map(([k, v]) => [k, stripPackage(v)])),
    Object.fromEntries(Object.entries(cand.packageTable).map(([k, v]) => [k, stripPackage(v)])), 'packages');

  // The control ranges and moving parts the page uses.
  if (ref.pageMotion && cand.pageMotion) { deepCompare(ref.pageMotion, cand.pageMotion, 'motion'); checked.push('page: control ranges and moving parts'); }
  return geometry;
}

/**
 * A compact description of a built view/: for every part, a fingerprint of its shape and of its
 * other data (poses, materials, names), plus its size, so a later build can be compared with it
 * without keeping a second copy of the geometry.
 */
export async function fingerprintView(viewDir) {
  const state = fingerprint(await readView(viewDir));
  // The confirmation levels the build worked out: a change of level or of a feature checklist must be seen and accepted like any other.
  try {
    const results = JSON.parse(await readFile(path.join(viewDir, 'assessment-results.json'), 'utf8')), rows = results.rows;
    state.targets = Object.fromEntries(Object.entries(results.targets).map(([id, t]) => [id, {definition: t.definition, outcome: t.outcome}]));
    state.confirmation = Object.fromEntries(Object.entries(rows).filter(([, r]) => r.level !== 1 || r.checklist !== 'placeholder').map(([id, r]) => [id, {level: r.level, required: r.features.filter(f => f.required).map(f => f.name)}]));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return state;
}

/** The same, from a view that has already been read. */
export function fingerprint(view) {
  const state = {parts: {}}, materials = view.meta.materials ?? [];
  const describe = (parts, bufferFor, table = materials) => {
    const {described, decoded} = describeParts(parts, bufferFor);
    for (const [id, part] of Object.entries(described)) {
      const {meshes, ...rest} = part, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const mesh of decoded[id]) for (let i = 0; i < mesh.positions.length; i++) { const v = mesh.positions[i]; if (v < lo[i % 3]) lo[i % 3] = v; if (v > hi[i % 3]) hi[i % 3] = v; }
      const {poses, spin, authoritativeBounds, ...other} = rest;   // the bounds follow the shape
      state.parts[id] = {shape: sha(JSON.stringify(meshes.map(m => m.content))), poses: sha(JSON.stringify(poses ?? null)), spin: sha(JSON.stringify([spin ?? null, meshes.map(m => m.deformation ?? null)])),
        other: sha(JSON.stringify([other, meshes.map(({content, deformation, vertices, triangles, pmin, pscale, indexType, m, ...rest}) => ({...rest, material: table[m] ?? null}))])),   // how the coordinates are packed follows the shape; materials by what they are, not by their number
        vertices: meshes.reduce((n, m) => n + m.vertices, 0), triangles: meshes.reduce((n, m) => n + m.triangles, 0), size_mm: hi.map((v, i) => Math.round((v - lo[i]) * 1000) / 1000)};
    }
  };
  const base = defaultExteriorMeta(view.meta);
  describe(base.parts, part => view.packages[part.package]);
  describe(exteriorStateParts(view.meta), part => view.packages[part.package]);
  describe(view.meta.alternatives.cassette.parts.map(p => ({...p, id: 'cassette alternative ' + p.id, package: 'cassette'})), () => view.packages.cassette, view.meta.alternatives.cassette.materials ?? []);
  // Model-wide data that is not a size or a checksum: materials, units, the viewer settings baked into the part list.
  const m = {...base, materials: [...(base.materials ?? [])].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)}, pick = keys => Object.fromEntries(keys.map(k => [k, m[k] ?? null]));   // materials in name order: their numbering follows the order parts are exported in
  state.settings = sha(JSON.stringify(pick(['units', 'materials', 'config', 'spin_sampling', 'frozen_controls', 'deformation_owners', 'legacy_static_shape_channels', 'inspectionContexts', 'fictional_serial', 'nativeCueSubstitutions', 'inactiveBindings'])));
  // Control travel. A part that a control drags also carries its own samples, so an assessment of that part can be tied to them.
  const controls = view.pageMotion?.controls || {};
  for (const [name, control] of Object.entries(controls)) for (const [id, samples] of Object.entries(control.parts || {}))
    if (state.parts[id]) { const {parts, ...rest} = control; state.parts[id].control = sha(JSON.stringify([state.parts[id].control ?? null, name, rest, samples])); }
  state.controls = sha(JSON.stringify([controls, m.controls ?? null]));
  return state;
}

/** What differs between two fingerprints, in words. An empty list means the same model. */
export function describeChanges(before, after) {
  const lines = [];
  for (const id of new Set([...Object.keys(before.parts), ...Object.keys(after.parts)])) {
    const a = before.parts[id], b = after.parts[id];
    if (!a) { lines.push(id + (id.startsWith('exterior ') ? ': new lettering state' : ': new part')); continue; }
    if (!b) { lines.push(id + ': removed'); continue; }
    const what = [];
    if (a.shape !== b.shape) {
      const grew = b.size_mm.map((v, i) => v - a.size_mm[i]), biggest = Math.max(...grew.map(Math.abs));
      what.push('shape' + (a.vertices !== b.vertices || a.triangles !== b.triangles ? ' (' + a.vertices + ' → ' + b.vertices + ' vertices)' : '') +
        (biggest >= 0.001 ? ', size ' + a.size_mm.join(' × ') + ' → ' + b.size_mm.join(' × ') + ' mm' : ', same overall size'));
    }
    if (a.poses !== b.poses) what.push('positions in one or more modes');
    if (a.spin !== b.spin) what.push('spin rate or deformation');
    if (a.control !== b.control) what.push('control travel');
    if (a.other !== b.other) what.push('name, material or grouping');
    if (what.length) lines.push(id + ': ' + what.join('; '));
  }
  if (before.settings !== after.settings) lines.push('materials or model-wide settings');
  if (before.controls !== after.controls) lines.push('control travel');
  if (before.targets && after.targets) for (const id of new Set([...Object.keys(before.targets), ...Object.keys(after.targets)])) {
    const a = before.targets[id], b = after.targets[id];
    if (!a) lines.push('target ' + id + ': new (' + b.outcome + ')');
    else if (!b) lines.push('target ' + id + ': removed');
    else if (a.definition !== b.definition) lines.push('target ' + id + ': redefined' + (a.outcome !== b.outcome ? ' (' + a.outcome + ' → ' + b.outcome + ')' : ''));
    else if (a.outcome !== b.outcome) lines.push('target ' + id + ': ' + a.outcome + ' → ' + b.outcome);
  }
  const was = before.confirmation || {}, is = after.confirmation || {};
  for (const id of new Set([...Object.keys(was), ...Object.keys(is)])) {
    const a = was[id] || {level: 1, required: null}, b = is[id] || {level: 1, required: null};
    if (a.level !== b.level) lines.push(id + ': confirmation level ' + a.level + ' → ' + b.level);
    if (JSON.stringify(a.required) !== JSON.stringify(b.required)) {
      const dropped = (a.required || []).filter(f => !(b.required || []).includes(f));
      lines.push(id + ': required features changed' + (dropped.length ? ' (no longer required: ' + dropped.join(', ') + ')' : ''));
    }
  }
  return lines;
}

/** Compares two view/ folders. Used by the build to say what a rebuild changed. */
export async function compareViews(referenceView, candidateView) {
  differences.length = 0; delete differences.overflow;
  const checked = [], geometry = comparePages(await readView(referenceView), await readView(candidateView), checked);
  return {equivalent: differences.length === 0, checked, geometry, differences: [...differences], truncated: !!differences.overflow};
}

export async function compareKits(referenceDir, candidateDir) {
  differences.length = 0; delete differences.overflow;
  const [ref, cand] = await Promise.all([readKit(referenceDir), readKit(candidateDir)]);
  const checked = [], geometry = comparePages(ref, cand, checked);

  // 3. The build's working files, when both kits still have them.
  if (ref.work && cand.work) {
    const full = async kit => { const model = await readJson(path.join(kit.work, 'model.json')), buffer = gunzipSync(await readFile(path.join(kit.work, 'model.bin.gz'))); return {model, parts: describeParts(model.parts, () => buffer)}; };
    const [a, b] = await Promise.all([full(ref), full(cand)]);
    const {parts: _p, ...aRest} = a.model, {parts: _q, ...bRest} = b.model;
    deepCompare(aRest, bRest, 'meta');
    const fullChange = compareParts('export.part', a.parts, b.parts);
    for (const [id, change] of Object.entries(fullChange)) geometry[id] = {...geometry[id], full_detail: change};
    for (const name of ['native-checks.json', 'inventory.json', 'motion.json']) {
      const before = await readJson(path.join(ref.work, name)), after = await readJson(path.join(cand.work, name)), label = name.replace('.json', '');
      for (const key of RECORD_LISTS[label] || []) { compareRecordList(before[key], after[key], label + '.' + key); delete before[key]; delete after[key]; }
      deepCompare(before, after, label);
    }
    checked.push('working files: full-detail export, motion samples, independent motion checks, inventory');
  }
  return {equivalent: differences.length === 0, checked, geometry, differences: [...differences], truncated: !!differences.overflow,
    reference: ref.dir, candidate: cand.dir};
}

if (import.meta.url === new URL(process.argv[1], 'file://').href || process.argv[1]?.endsWith('compare.mjs')) {
  const flagValues = new Set(process.argv.filter((a, i) => process.argv[i - 1]?.startsWith('--')));
  const [referenceDir, candidateDir] = process.argv.slice(2).filter(a => !a.startsWith('--') && !flagValues.has(a));
  if (!referenceDir || !candidateDir) { console.error('usage: node compare.mjs <reference kit> <candidate kit> [--report file.json]'); process.exit(2); }
  const result = await compareKits(referenceDir, candidateDir);
  const reportAt = process.argv.indexOf('--report');
  if (reportAt > 0) await writeFile(process.argv[reportAt + 1], JSON.stringify(result, null, 2) + '\n');
  console.log('Compared ' + path.basename(path.resolve(result.candidate)) + ' with the reference ' + path.basename(path.resolve(result.reference)));
  for (const line of result.checked) console.log('  checked ' + line);
  if (result.equivalent) console.log('IDENTICAL: every part, pose and motion sample matches the reference.');
  else {
    console.log('DIFFERENT: ' + result.differences.length + (result.truncated ? '+' : '') + ' differences');
    for (const [id, c] of Object.entries(result.geometry).slice(0, 20)) console.log('  ' + id + ': ' + (c.topology ? 'vertex or triangle layout changed' : 'moved up to ' + c.position_mm.toFixed(4) + ' mm, normals up to ' + c.normal_deg.toFixed(3) + '°'));
    for (const d of result.differences.slice(0, 25)) console.log('  ' + d.where + ': ' + d.what);
    process.exitCode = 1;
  }
}
