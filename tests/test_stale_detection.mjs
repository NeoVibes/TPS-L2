// A build goes out of date when any of its inputs is added, removed or changed, wherever the file
// lives in the kit. The release wording is an input of the page only, not of the Blender stages.
import './test_setup.mjs';
import assert from 'node:assert/strict';
import {inputChanges, modelInputs, viewerInputs, kitPath} from '../tools/integrity.mjs';

const recorded = {'rebuild/viewer/a.mjs': '1', 'edit/service-manual-parts.csv': '2', 'rebuild/viewer/gone.mjs': '3'};
const current = {'rebuild/viewer/a.mjs': '1', 'edit/service-manual-parts.csv': 'edited', 'rebuild/viewer/new.mjs': '4'};
assert.deepEqual(inputChanges(recorded, current), ['edit/service-manual-parts.csv (changed)', 'rebuild/viewer/gone.mjs (removed)', 'rebuild/viewer/new.mjs (new)']);
assert.deepEqual(inputChanges(recorded, recorded), []);

const model = Object.keys(await modelInputs()).map(kitPath), page = Object.keys(await viewerInputs()).map(kitPath);
assert(page.includes('edit/service-manual-parts.csv'), 'the service catalogue is an input of the page');
for (const file of ['edit/targets.json', 'edit/assessments.json', 'rebuild/tools/targets.mjs', 'rebuild/tools/confirmation.mjs']) assert(page.includes(file), file + ' decides the lists beside the page');
for (const file of ['rebuild/tools/measure_targets.py', 'rebuild/tools/solid_measure.py']) assert(model.includes(file), file + ' decides what Blender measures');
assert(page.includes('rebuild/config/release.json'), 'the release wording is an input of the page');
assert(!model.includes('rebuild/config/release.json'), 'the release wording must not force a Blender rebuild');
assert(model.includes('edit/Portable Tape Player.blend'));
console.log('Stale detection covers', model.length, 'model inputs and', page.length, 'page inputs');
