// view/master-parts.csv lists every modelled part (each cassette part once per cassette) and every
// service-manual entry that has no model part, with the model's own sizes and each row's level.
import './test_setup.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {VIEW, serviceCatalog, json, TARGETS} from '../tools/integrity.mjs';
import {parseCsv} from '../viewer/service-catalog.mjs';
import {readView} from '../tools/compare.mjs';
import {confirmation, MASTER_COLUMNS} from '../tools/confirmation.mjs';
import {exteriorStates} from '../viewer/exterior.mjs';

const text = readFileSync(path.join(VIEW, 'master-parts.csv'), 'utf8'), [header, ...lines] = parseCsv(text);
const rows = lines.map(r => Object.fromEntries(header.map((name, i) => [name, r[i]])));
assert.deepEqual(header, MASTER_COLUMNS);
assert(header.includes('level_notes') && header.includes('feature_levels') && header.includes('targets'));
// The inventory columns: what each part is, where it is stored, and the model's own sizes.
for (const column of ['part_id', 'name', 'group', 'category', 'geometry_file', 'manual_part_no', 'manual_ref_no', 'manual_catalog_id', 'model_width_mm', 'model_depth_mm', 'model_height_mm',
  'model_longest_length_mm', 'model_volume_mm3', 'closed_solid', 'why_not_closed', 'blender_objects', 'vertices', 'faces', 'moves']) assert(header.includes(column), column);
assert.equal(new Set(rows.map(r => r.row_id)).size, rows.length, 'row ids are unique');

const view = await readView(VIEW), catalog = await serviceCatalog(), modelled = rows.filter(r => r.status === 'modelled');
for (const part of view.meta.parts) {
  const mine = modelled.filter(r => r.part_id === part.id);
  if (part.is_cassette) assert.deepEqual(mine.map(r => r.variant).sort(), ['detailed', 'original'], part.id + ' has a row for each cassette');
  else {
    // A part whose lettering differs between exterior versions has a row for each distinct state; every other part has one row.
    const states = exteriorStates(part, view.meta.exterior);
    if (states.length) { assert.deepEqual(mine.map(r => r.variant), states.map(s => s.name), part.id + ' has a row for each exterior state'); assert(mine.every(r => r.row_id === part.id + '/' + r.variant)); }
    else { assert.equal(mine.length, 1, part.id); assert.equal(mine[0].row_id, part.id); assert.equal(mine[0].variant, ''); }
  }
  for (const r of mine) { assert(Number(r.model_width_mm) > 0 && Number(r.vertices) > 0, r.row_id + ' has its sizes'); assert(Number(r.confirmation_level) >= 1); assert.match(r.features_confirmed, /^\d+ of \d+$/); }
}
assert.equal(modelled.length, view.meta.parts.reduce((n, p) => n + (p.is_cassette ? 2 : Math.max(1, exteriorStates(p, view.meta.exterior).length)), 0));
const ids = new Set(view.meta.parts.map(p => p.id)), missing = catalog.filter(e => !e.partIds.some(id => ids.has(id)));
assert.deepEqual(rows.filter(r => r.status === 'not modelled').map(r => r.manual_catalog_id), missing.map(e => e.id), 'every service-manual entry without a model part is listed');
for (const r of rows.filter(r => r.status === 'not modelled')) { assert.equal(r.confirmation_level, '0'); assert.equal(r.model_width_mm, ''); }
// A part named by targets shows them with their outcome.
const targets = (await json(TARGETS)).targets.filter(t => (t.parts || []).includes('BAY-052'));
for (const t of targets) assert(rows.find(r => r.row_id === 'BAY-052').targets.includes(t.id + ' ('), t.id);
// The files in view/ are exactly what the current lists and model give.
const again = await confirmation(view, JSON.parse(readFileSync(path.join(VIEW, 'build-record.json'), 'utf8')).version);
for (const [name, content] of Object.entries(again.files)) assert.equal(readFileSync(path.join(VIEW, name), 'utf8'), content, 'view/' + name + ' matches the lists in edit/');
console.log('Master list:', modelled.length, 'modelled rows,', rows.length - modelled.length, 'not modelled; all three lists in view/ match their sources');
