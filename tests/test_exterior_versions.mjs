// The three exterior versions: one choice shows exactly its own lettering, the shells are shared,
// the default version is the model as it was before versions existed, and the table of versions in
// edit/targets.json says what the model shows.
import './test_setup.mjs';
import assert from 'node:assert/strict';
import {VIEW, json, TARGETS, serviceCatalog} from '../tools/integrity.mjs';
import {readView, fingerprint, exteriorStateParts} from '../tools/compare.mjs';
import {shownIn, defaultMeshes, exteriorStates, defaultExteriorMeta} from '../viewer/exterior.mjs';
import {versionProblems, catalogStateProblems, listRows, fingerprintKey} from '../tools/confirmation.mjs';

const view = await readView(VIEW), meta = view.meta, exterior = meta.exterior, release = await json('config/release.json'), targetFile = await json(TARGETS);
assert(exterior.versions.length >= 2 && exterior.default === exterior.versions[0], 'the first choice is the default');
assert.deepEqual(release.exteriors.map(e => e.id), exterior.versions, 'every version has its label, in the same order');
for (const e of release.exteriors) assert(e.label && e.lettering && /about/.test(e.serials), e.id + ': serial ranges are given as approximate');
assert.match(release.exteriorNote, /lettering/i);

// Tags: only lettering pieces carry them, each names some but not all versions, and no part is a version by itself.
const tagged = meta.parts.flatMap(p => p.meshes.filter(m => m.versions).map(m => ({part: p.id, ...m})));
assert(tagged.length > 0);
for (const m of tagged) {
  assert(m.versions.length > 0 && m.versions.length < exterior.versions.length && m.versions.every(v => exterior.versions.includes(v)), m.piece + ': ' + m.versions);
  assert(m.piece, m.part + ': a version-specific mesh says which lettering piece it is');
}
const positions = [...new Set(tagged.map(m => m.part))].sort();
assert.deepEqual(positions, ['EXT-010', 'EXT-020', 'EXT-030', 'GRL-001'], 'only the four exterior positions differ between versions');

// Every version shows exactly one state of each position, and the states partition the versions.
for (const id of positions) {
  const part = meta.parts.find(p => p.id === id), states = exteriorStates(part, exterior);
  assert.deepEqual(states.flatMap(s => s.versions).sort(), [...exterior.versions].sort(), id);
  assert.equal(states.filter(s => s.base).length, 1);
  for (const v of exterior.versions) assert.equal(states.filter(s => s.versions.includes(v)).length, 1, id + ' has one state in ' + v);
  // The shell itself is in every state: the untagged meshes.
  const shell = part.meshes.filter(m => !m.versions);
  for (const s of states) for (const m of shell) assert(s.meshes.includes(m), id + ': the shell is shared');
}
assert.deepEqual(exteriorStates(meta.parts.find(p => p.id === 'BAY-052'), exterior), [], 'a part with no version-specific lettering has no states');
assert.equal(shownIn({}, 'early'), true); assert.equal(shownIn({versions: ['later']}, 'early'), false);

// The default version is the plain model: no tags, no extra materials, and its own triangle count.
const plain = defaultExteriorMeta(meta);
assert(!('exterior' in plain) && plain.parts.every(p => p.meshes.every(m => !('versions' in m) && !('piece' in m))));
assert.equal(plain.triangles, plain.parts.reduce((n, p) => n + p.meshes.reduce((k, m) => k + m.i[1] / 3, 0), 0));
assert(plain.materials.length < meta.materials.length, 'materials only other versions use come after all the others');
for (const p of meta.parts) assert.deepEqual(defaultMeshes(p, exterior).map(m => m.m).filter(i => i >= plain.materials.length), [], p.id);

// The table of versions agrees with the model, and disagreement in either direction is noticed.
assert.deepEqual(versionProblems(targetFile, meta), []);
const copy = v => JSON.parse(JSON.stringify(v));
const wrongTable = copy(targetFile); wrongTable.versions.areas.find(a => a.area === 'Back').early = wrongTable.versions.areas.find(a => a.area === 'Back').later;
assert.match(versionProblems(wrongTable, meta).join(' | '), /EXT-010.*but the model shows/);
const wrongModel = copy(meta); for (const p of wrongModel.parts) if (p.id === 'EXT-030') for (const m of p.meshes) delete m.versions;
assert.match(versionProblems(targetFile, wrongModel).join(' | '), /EXT-030.*but the model shows/);
const missing = copy(targetFile); missing.versions.areas = missing.versions.areas.filter(a => a.part !== 'GRL-001');
assert.match(versionProblems(missing, meta).join(' | '), /GRL-001 shows different lettering .* but is not in the table/);
// Nothing in the table may be called "not yet modelled": every area it lists is in the model, as the checks above show.
assert(!JSON.stringify(targetFile.versions).toLowerCase().includes('not yet modelled'));

// Fingerprints: the default state under the part's own ID, every other state under its own name.
const prints = fingerprint(view);
for (const p of exteriorStateParts(meta)) assert(prints.parts[p.id], p.id);
assert.equal(fingerprintKey('EXT-030', 'later', prints.parts), 'EXT-030');
assert.equal(fingerprintKey('EXT-030', 'intermediate+early', prints.parts), 'exterior intermediate+early EXT-030');
assert.notEqual(prints.parts['EXT-030'].shape, prints.parts['exterior intermediate+early EXT-030'].shape);
// Recolouring a piece of lettering changes the state that shows it, and nothing else.
const tinted = structuredClone(meta), green = tagged.find(m => m.versions.join() === 'intermediate' && m.part === 'GRL-001');
tinted.materials[green.m].color = [1, 0, 0];
const reprints = fingerprint({...view, meta: tinted});
assert.deepEqual(Object.keys(prints.parts).filter(id => JSON.stringify(prints.parts[id]) !== JSON.stringify(reprints.parts[id])), ['exterior intermediate GRL-001']);
assert.equal(reprints.settings, prints.settings);

// Rows and service-manual numbers follow the states.
const catalog = await serviceCatalog(), rows = listRows(view, catalog);
assert.deepEqual(catalogStateProblems(catalog, rows), []);
const row = id => rows.find(r => r.row_id === id);
assert(row('EXT-030/later').manual_part_no.includes('X-3568-711-2') && !row('EXT-030/later').manual_part_no.includes('X-3568-711-0'));
assert(row('EXT-030/intermediate+early').manual_part_no.includes('X-3568-711-0'));
assert.equal(row('EXT-020/early').manual_part_no, '', 'the manual has no separate number for the early upper panel');
const bad = copy(catalog); bad[0].partStates = {'EXT-030': ['no such state']};
assert.match(catalogStateProblems(bad, rows).join(' | '), /EXT-030\/no such state/);

// The printed lettering of the early version lies on the moulded letters it covers. Coordinates are mm in the part's own frame.
function points(part, mesh) {
  const buffer = view.packages[part.package], q = new Uint16Array(buffer.buffer.slice(buffer.byteOffset + mesh.p[0], buffer.byteOffset + mesh.p[0] + mesh.p[1] * 2)), out = [];
  for (let i = 0; i < q.length; i += 3) out.push([0, 1, 2].map(k => q[i + k] * mesh.pscale[k] + mesh.pmin[k]));
  return out;
}
function triangles(part, mesh) {
  const buffer = view.packages[part.package], pts = points(part, mesh), at = buffer.byteOffset + mesh.i[0];
  const index = mesh.indexType === 'u16' ? new Uint16Array(buffer.buffer.slice(at, at + mesh.i[1] * 2)) : new Uint32Array(buffer.buffer.slice(at, at + mesh.i[1] * 4)), out = [];
  for (let i = 0; i < index.length; i += 3) out.push([pts[index[i]], pts[index[i + 1]], pts[index[i + 2]]]);
  return out;
}
const area = faces => faces.reduce((sum, [a, b, c]) => { const u = [0, 1, 2].map(k => b[k] - a[k]), v = [0, 1, 2].map(k => c[k] - a[k]); return sum + Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2; }, 0);
const box = pts => { const b = [[Infinity, -Infinity], [Infinity, -Infinity], [Infinity, -Infinity]]; for (const p of pts) for (const k of [0, 1, 2]) { if (p[k] < b[k][0]) b[k][0] = p[k]; if (p[k] > b[k][1]) b[k][1] = p[k]; } return b; };
for (const [id, piece, stroke] of [['EXT-010', 'ART • rear STEREO print', 0.87], ['GRL-001', 'ART • legends print', 0]]) {
  const part = meta.parts.find(p => p.id === id), print = part.meshes.find(m => m.piece === piece), pb = box(points(part, print));
  const sizes = pb.map(([lo, hi]) => hi - lo), flat = sizes.indexOf(Math.min(...sizes)), plane = pb[flat][0];    // the print is flat: this is the axis it faces along
  assert(sizes[flat] < 0.005, piece + ' is flat');
  // The moulded letters under it: shell points just beneath the print, inside its outline (with a 1 mm margin).
  const shell = part.meshes.filter(m => !m.versions).flatMap(m => points(part, m)), sb = box(shell), sign = Math.sign(plane - (sb[flat][0] + sb[flat][1]) / 2);
  const under = shell.filter(p => (plane - p[flat]) * sign > 0 && (plane - p[flat]) * sign < 0.04 && [0, 1, 2].every(k => k === flat || p[k] > pb[k][0] - 1 && p[k] < pb[k][1] + 1));
  assert(under.length > 1000, piece + ' has moulded letters beneath it (' + under.length + ' points)');
  const ub = box(under);
  for (const k of [0, 1, 2]) if (k !== flat) {
    const drift = Math.abs((ub[k][0] + ub[k][1]) / 2 - (pb[k][0] + pb[k][1]) / 2);
    assert(drift < 0.05, piece + ' is centred on the moulded letters to ' + drift.toFixed(3) + ' mm');
    const wider = (pb[k][1] - pb[k][0]) - (ub[k][1] - ub[k][0]);
    // A bold outline is centred on the hairline it traces, so it reaches about half its stroke beyond it on each side (a little more at corners).
    assert(wider > -0.01 && wider < stroke * 1.5 + 0.1, piece + ' covers the moulded letters and reaches ' + wider.toFixed(3) + ' mm beyond them in all');
  }
  const gap = (plane - ub[flat][sign > 0 ? 1 : 0]) * sign;
  assert(gap > 0.005 && gap < 0.03, piece + ' sits ' + gap.toFixed(3) + ' mm outside the letters');
  // A stroke follows the moulded line everywhere. A face of it that lies off the line would cut across a letter.
  if (stroke) {
    const [u, v] = [0, 1, 2].filter(k => k !== flat); let worst = 0;
    for (const t of triangles(part, print)) {
      const cu = (t[0][u] + t[1][u] + t[2][u]) / 3, cv = (t[0][v] + t[1][v] + t[2][v]) / 3; let best = Infinity;
      for (const p of under) { const d = (p[u] - cu) ** 2 + (p[v] - cv) ** 2; if (d < best) best = d; }
      if (best > worst) worst = best;
    }
    assert(Math.sqrt(worst) < stroke / 2 + 0.1, piece + ' has a face ' + Math.sqrt(worst).toFixed(2) + ' mm from the moulded line');
  }
  // A print that copies the letters themselves (no outline) has their area: no gap of a letter is filled in.
  if (!stroke) {
    const top = ub[flat][sign > 0 ? 1 : 0], faces = part.meshes.filter(m => !m.versions).flatMap(m => triangles(part, m))
      .filter(t => t.every(p => Math.abs(p[flat] - top) < 0.002 && [0, 1, 2].every(k => k === flat || p[k] > pb[k][0] - 1 && p[k] < pb[k][1] + 1)));
    const printed = area(triangles(part, print)), moulded = area(faces);
    assert(Math.abs(printed - moulded) < moulded * 0.03, piece + ' covers ' + printed.toFixed(2) + ' mm², the moulded letters ' + moulded.toFixed(2) + ' mm²');
  }
}
// The STEREO on the door is the lettering on the back, smaller: the same proportions, and the same share of its box covered.
const lettering = (id, piece) => { const part = meta.parts.find(p => p.id === id), mesh = part.meshes.find(m => m.piece === piece), sizes = box(points(part, mesh)).map(([lo, hi]) => hi - lo).sort((a, b) => b - a); return {proportion: sizes[1] / sizes[0], covered: area(triangles(part, mesh)) / (sizes[0] * sizes[1])}; };
const back = lettering('EXT-010', 'ART • rear STEREO print'), door = lettering('EXT-030', 'ART • lid STEREO');
assert(Math.abs(door.proportion / back.proportion - 1) < 0.01 && Math.abs(door.covered / back.covered - 1) < 0.02, 'door STEREO ' + JSON.stringify(door) + ', back ' + JSON.stringify(back));
// On top (viewer axes: 0 across, 1 up, 2 toward the front). Positions come from one photograph of two top panels,
// with the sockets taken as 12 mm apart.
{
  const upper = meta.parts.find(p => p.id === 'EXT-020'), sockets = meta.parts.find(p => p.id === 'JCK-01'), green = sockets.meshes.flatMap(m => points(sockets, m));
  const top = Math.max(...green.map(p => p[1])), rings = green.filter(p => p[1] > top - 0.05);      // the green rings as seen from above
  // The small labels at the headphone sockets stand clear of the sockets in every version.
  for (const v of exterior.versions) {
    const labels = upper.meshes.filter(m => /Headphone [AB]$|GUYS/.test(m.piece || '') && shownIn(m, v));
    assert(labels.length, v + ' has labels at the headphone sockets');
    let nearest = Infinity;
    for (const m of labels) for (const p of points(upper, m)) for (const r of rings) nearest = Math.min(nearest, Math.hypot(p[0] - r[0], p[2] - r[2]));
    assert(nearest > 1 && nearest < 3, v + ': the socket labels stand ' + nearest.toFixed(2) + ' mm from the sockets');
  }
  // The OPERATION lamp: 2.0 mm right of socket B and 13.85 mm behind the sockets' line, through its own hole in the panel.
  const middle = (rings.reduce((s, p) => s + p[0], 0) / rings.length), socketB = box(rings.filter(p => p[0] > middle)).map(([lo, hi]) => (lo + hi) / 2);
  const lamp = meta.parts.find(p => p.id === 'EXT-061'), resin = points(lamp, lamp.meshes.find(m => meta.materials[m.m].operationIndicator)), panel = upper.meshes.filter(m => !m.versions).flatMap(m => points(upper, m));
  const panelTop = Math.max(...panel.map(p => p[1])), dome = box(resin.filter(p => p[1] > panelTop)), axis = [(dome[0][0] + dome[0][1]) / 2, (dome[2][0] + dome[2][1]) / 2], stem = (dome[0][1] - dome[0][0]) / 2;
  assert(Math.abs(axis[0] - socketB[0] - 2.0) < 0.3 && Math.abs(socketB[2] - axis[1] - 13.85) < 0.3, 'the lamp is ' + (axis[0] - socketB[0]).toFixed(2) + ' mm right of socket B and ' + (socketB[2] - axis[1]).toFixed(2) + ' mm behind it');
  const rim = panel.filter(p => p[1] > panelTop - 0.7).map(p => Math.hypot(p[0] - axis[0], p[2] - axis[1])).filter(r => r < 1.2);
  assert(rim.length >= 64 && Math.min(...rim) > stem + 0.05, 'the lamp stands in a hole of its own: ' + rim.length + ' points of the panel within 1.2 mm, the nearest ' + Math.min(...rim, 9).toFixed(2) + ' mm from its axis');
  // Its label is the white lettering level with it, and ends to its left.
  const words = upper.meshes.filter(m => !m.versions).map(m => box(points(upper, m))).filter(b => b[1][1] - b[1][0] < 0.01 && Math.abs((b[2][0] + b[2][1]) / 2 - axis[1]) < 0.6);
  assert.equal(words.length, 1, 'one label is level with the lamp');
  const gap = axis[0] - stem - words[0][0][1];
  assert(gap > 1 && gap < 2.2, 'OPERATION ends ' + gap.toFixed(2) + ' mm left of the lamp');
  // Inside, the lamp's body stays above the servo board it stands over.
  const board = meta.parts.find(p => p.id === 'SB-001'), slab = box(board.meshes.flatMap(m => points(board, m)).filter(p => Math.abs(p[0] - axis[0]) < 2));
  const over = resin.filter(p => p[2] > slab[2][0] && p[2] < slab[2][1]);
  assert(over.length && Math.min(...over.map(p => p[1])) > slab[1][1] + 0.1, 'the lamp clears the servo board by ' + (Math.min(...over.map(p => p[1])) - slab[1][1]).toFixed(2) + ' mm');
}
console.log('Exterior versions:', exterior.versions.join(', '), '|', tagged.length, 'version-specific meshes on', positions.length, 'parts | table and model agree');
