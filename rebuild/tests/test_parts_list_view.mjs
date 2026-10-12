// The parts list in Inspect (viewer/app-master-list.mjs): filtering, row labels, and what a
// contributor is handed. Only a part ID ever goes into an address.
import './test_setup.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {VIEW, json} from '../tools/integrity.mjs';
import {parseMasterList, filterRows, rowLabel, submission, variantLabel} from '../viewer/app-master-list.mjs';
import {pageHtml} from './kit_files.mjs';

const csv = readFileSync(path.join(VIEW, 'master-parts.csv'), 'utf8'), rows = parseMasterList(csv);
// The page carries the same list as the file beside it, the level descriptions and the repository setting.
const embedded = JSON.parse(pageHtml().match(/<script type="application\/json" id="masterParts">([^]*?)<\/script>/)[1]);
assert.equal(embedded.csv, csv, 'the list in the page is view/master-parts.csv');
assert.equal(embedded.levels.length, 7);
assert.equal(embedded.repository, (await json('config/release.json')).repository);

assert.equal(filterRows(rows).length, rows.length);
assert.equal(filterRows(rows, {status: 'not modelled'}).length, rows.filter(r => r.status === 'not modelled').length);
assert(filterRows(rows, {level: '0'}).every(r => r.status === 'not modelled'));
assert.equal(filterRows(rows, {level: 0}).length, filterRows(rows, {level: '0'}).length);
assert.deepEqual(filterRows(rows, {text: 'bay-052'}).map(r => r.row_id), ['BAY-052'], 'text is matched without regard to case');
assert.deepEqual(filterRows(rows, {text: 'MEDIA-001'}).map(r => r.variant).sort(), ['detailed', 'original']);
assert(filterRows(rows, {text: 'capstan', status: 'modelled', level: '1'}).length > 1);
assert.equal(filterRows(rows, {text: 'no such part anywhere'}).length, 0);
// Part numbers from the service manual are searchable, for modelled and unmodelled rows.
const withNumber = rows.find(r => r.status === 'modelled' && r.manual_part_no), missing = rows.find(r => r.status === 'not modelled' && r.manual_part_no);
assert(filterRows(rows, {text: withNumber.manual_part_no.split(' ')[0]}).some(r => r.row_id === withNumber.row_id));
assert(filterRows(rows, {text: missing.manual_part_no}).some(r => r.row_id === missing.row_id));

assert.match(rowLabel(rows.find(r => r.row_id === 'MEDIA-001/detailed')), /^MEDIA-001 · .* · detailed cassette · level \d$/);
assert.match(rowLabel(missing), /^Not modelled · .* · level 0$/);
// A part whose lettering differs between exterior versions has a row per state, labelled with the versions that show it.
assert.deepEqual(filterRows(rows, {text: 'EXT-030'}).map(r => r.variant), ['later', 'intermediate+early']);
assert.equal(variantLabel('intermediate+early'), 'intermediate and early exterior'); assert.equal(variantLabel('detailed'), 'detailed cassette'); assert.equal(variantLabel(''), '');
assert.match(rowLabel(rows.find(r => r.row_id === 'EXT-030/later')), / · later exterior · level \d$/);
assert.deepEqual(embedded.exteriors.map(e => e.id), ['later', 'intermediate', 'early']); assert.match(embedded.exteriorNote, /approximate/);
assert.match(submission('confirmation', rows.find(r => r.row_id === 'EXT-030/intermediate+early'), '').text, /Exterior version of your player[^\n]*: intermediate or early\n/);

// Submissions: copyable text without a repository; with one, the form's address carrying the part ID and nothing else.
const part = rows.find(r => r.row_id === 'BAY-052');
const copy = submission('confirmation', part, '');
assert.match(copy.text, /Photos or links to photos: \n/);
assert.equal(copy.url, null); assert.match(copy.text, /^Confirmation\nPart ID: BAY-052 /); assert.match(copy.text, /hide serial numbers.*name and address.*location data/);
const linked = submission('confirmation', part, 'https://github.com/example/portable-tape-player/');
assert.equal(linked.url, 'https://github.com/example/portable-tape-player/issues/new?template=confirmation.yml&part=BAY-052');
assert.equal(submission('part', missing, 'https://github.com/example/x').url, 'https://github.com/example/x/issues/new?template=part.yml&part=' + encodeURIComponent(missing.manual_part_no));
assert.equal(submission('part', null, 'https://github.com/example/x').url, 'https://github.com/example/x/issues/new?template=part.yml');
assert.match(submission('part', null, '').text, /^New or corrected part\n/);
// The two issue forms are kept in publish/github/ under the names the addresses use. Both carry the
// privacy reminders, ask which exterior version the player is, and accept links in place of uploads.
for (const form of ['confirmation.yml', 'part.yml']) {
  const text = readFileSync(path.join(VIEW, '../publish/github', form), 'utf8');
  assert.match(text, /id: part\n/); assert.match(text, /Hide serial numbers/); assert.match(text, /Location data has been removed/); assert.match(text, /A page you link to is public/);
  assert.match(text, /id: exterior\n/); for (const e of embedded.exteriors) assert(text.includes('"' + e.label + ': '), form + ' offers ' + e.label);
  assert.match(text, /links? to photos/); assert.match(text, /id: edited_copy\n/); assert.match(text, /Never the whole number/);
}
assert.match(readFileSync(path.join(VIEW, '../publish/github/confirmation.yml'), 'utf8'), /- Not sure\n/);
console.log('Parts list view:', rows.length, 'rows; filters, labels and submissions behave as specified');
