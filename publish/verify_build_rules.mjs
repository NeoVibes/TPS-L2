// Proves the build's rules on a throwaway copy of the kit, without Blender:
//   - editing a list, the wording or the viewer source makes the page out of date, and build:viewer repairs it
//   - editing something Blender reads makes the model out of date, and build:viewer refuses
//   - a failed build leaves view/ exactly as it was
//   - a mismatched dependency is reported
//   - the table of exterior versions must agree with the model
//   - the release tool needs no git, ships the right files and refuses a file that names this computer
//   - an assessment raises a level only after "accept", and stops counting when its target is redefined
//
//   node publish/verify_build_rules.mjs "/path/to/new scratch folder"
import {cp, readFile, writeFile, rm, access, mkdir} from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {KIT, walk} from '../rebuild/tools/integrity.mjs';

const scratch = path.resolve(process.argv[2] || '');
if (!process.argv[2] || scratch === KIT || scratch.startsWith(KIT + path.sep)) throw Error('Usage: node publish/verify_build_rules.mjs "/path/to/new scratch folder" (outside the kit)');
if (await access(scratch).then(() => true, () => false)) throw Error('The scratch folder already exists; choose a new one.');
await cp(KIT, scratch, {recursive: true, filter: source => !['.git', 'build'].includes(path.basename(source)) || !['', 'rebuild'].includes(path.relative(KIT, path.dirname(source)))});

const at = relative => path.join(scratch, relative), rebuild = at('rebuild');
const env = {...process.env, BLENDER_BIN: path.join(scratch, 'no-blender-here')};   // any attempt to start Blender fails
const run = (script, args = [], extra = {}) => spawnSync(process.execPath, [path.join(rebuild, 'tools', script), ...args], {cwd: rebuild, env: {...env, ...extra}, encoding: 'utf8'});
const facts = () => { const r = spawnSync(process.execPath, ['-e', "import('./tools/check.mjs').then(async m => console.log(JSON.stringify(await m.checkKit())))"], {cwd: rebuild, env, encoding: 'utf8'}); return JSON.parse(r.stdout); };
const viewHashes = async () => { const out = {}; for (const p of await walk(path.relative(path.join(KIT, 'rebuild'), at('view')))) out[path.basename(path.dirname(p)) + '/' + path.basename(p)] = createHash('sha256').update(await readFile(path.resolve(KIT, 'rebuild', p))).digest('hex'); return out; };
const edit = async (relative, change) => { const before = await readFile(at(relative), 'utf8'); await writeFile(at(relative), change(before)); return () => writeFile(at(relative), before); };
const json = async relative => JSON.parse(await readFile(at(relative), 'utf8'));
const masterRow = async id => { const {parseCsv} = await import('../rebuild/viewer/service-catalog.mjs'); const [header, ...rows] = parseCsv(await readFile(at('view/master-parts.csv'), 'utf8')); const r = rows.find(r => r[0] === id); return Object.fromEntries(header.map((h, i) => [h, r[i]])); };
const done = [];

try {
  let state = facts();
  assert.deepEqual([state.errors, state.facts.out_of_date], [[], []], 'the copy starts clean');
  const geometry = async () => Object.fromEntries(Object.entries(await viewHashes()).filter(([p]) => p.startsWith('geometry/') || p.startsWith('cassette/')));
  const geometryBefore = await geometry();

  // 1. Page inputs: each is noticed by name, and build:viewer repairs it without Blender.
  for (const [file, change] of [
    ['edit/service-manual-parts.csv', s => s.replace('Reel Panel Assy', 'Reel panel assembly')],
    ['edit/targets.json', s => s.replace('"basis": "ECMA-34 Fig. 4"', '"basis": "ECMA-34, Fig. 4"')],
    ['edit/assessments.json', s => s.replace('"corroborations": []', '"corroborations": [ ]')],
    ['rebuild/config/release.json', s => s.replace('This model is an estimate.', 'This model is an estimate, for now.').replace('"label": "Later"', '"label": "Latest"')],
    ['rebuild/viewer/page.css', s => s + '\n/* edited */\n']]) {
    await edit(file, change);
    state = facts();
    assert(state.facts.page_out_of_date.some(line => line.startsWith(file)), file + ' is noticed: ' + state.facts.page_out_of_date);
    assert.deepEqual(state.facts.model_out_of_date, [], file + ' does not ask for Blender');
    const built = run('build.mjs', ['--viewer']);
    assert.equal(built.status, 0, 'build:viewer after editing ' + file + ': ' + built.stderr);
    state = facts();
    assert.deepEqual([state.errors, state.facts.out_of_date], [[], []], 'clean again after ' + file);
  }
  assert((await readFile(at('view/index.html'), 'utf8')).includes('This model is an estimate, for now.'), 'the new wording is on the page');
  assert((await readFile(at('view/index.html'), 'utf8')).includes('"label":"Latest"') && (await readFile(at('view/TARGETS.md'), 'utf8')).includes('| Latest |'), 'a renamed exterior version reaches the page and the target reference');
  assert((await readFile(at('view/TARGETS.md'), 'utf8')).includes('ECMA-34, Fig. 4'), 'the edited target is in the reference');
  assert.deepEqual(await geometry(), geometryBefore, 'the geometry files were not touched');
  done.push('five kinds of page input are noticed and rebuilt without Blender; geometry untouched');

  // 2. A model input: noticed, and build:viewer refuses rather than pair old geometry with new tools.
  const before = await viewHashes();
  const restore = await edit('rebuild/tools/solid_measure.py', s => s + '\n# edited\n');
  state = facts();
  assert(state.facts.model_out_of_date.some(line => line.startsWith('rebuild/tools/solid_measure.py')), 'a Blender script is a model input');
  const refused = run('build.mjs', ['--viewer']);
  assert.notEqual(refused.status, 0); assert.match(refused.stderr, /Run npm run build \(needs Blender\)/);
  assert.equal(run('build.mjs').status, 1, 'and the full build cannot run without Blender');
  assert.deepEqual(await viewHashes(), before, 'view/ is exactly as it was after both refusals');
  await restore();
  done.push('a model input is noticed; build:viewer refuses; view/ untouched');

  // 3. A build that fails at the last moment leaves view/ alone and cleans up.
  const failed = run('build.mjs', ['--viewer'], {PTP_TEST_FAIL_BEFORE_SWAP: '1'});
  assert.notEqual(failed.status, 0); assert.match(failed.stderr, /view\/ is unchanged/);
  assert.deepEqual(await viewHashes(), before); assert(!(await access(at('view.staging')).then(() => true, () => false)), 'no staging folder is left behind');
  done.push('a failed build leaves view/ intact');

  // 4. A dependency that is not the locked version is an error.
  const undo = await edit('rebuild/node_modules/esbuild/package.json', s => s.replace(/"version": "[^"]+"/, '"version": "0.0.1"'));
  assert(facts().errors.some(line => /esbuild 0\.0\.1 is installed but the lock file asks for/.test(line)));
  await undo();
  done.push('a mismatched dependency is reported');

  // 5. The table of exterior versions in edit/targets.json must say what the model shows.
  const untable = await edit('edit/targets.json', s => { const f = JSON.parse(s); const back = f.versions.areas.find(a => a.part === 'EXT-010'); back.early = back.later; return JSON.stringify(f, null, 1) + '\n'; });
  const disagrees = run('build.mjs', ['--viewer']);
  assert.notEqual(disagrees.status, 0); assert.match(disagrees.stderr, /versions table: for EXT-010/);
  assert.deepEqual(await viewHashes(), before, 'view/ is untouched when the table and the model disagree');
  await untable();
  done.push('a versions table that disagrees with the model stops the build');

  // 6. The release tool: no git anywhere, the right files, the same bytes each time, and no file that names this computer.
  assert(!(await access(at('.git')).then(() => true, () => false)), 'the copy has no git folder');
  const out = n => scratch + '-zip-' + n, release = folder => spawnSync(process.execPath, [at('publish/release.mjs'), folder], {cwd: scratch, env, encoding: 'utf8'});
  const first = release(out(1));
  assert.equal(first.status, 0, first.stderr);
  const version = JSON.parse(await readFile(at('rebuild/config/release.json'), 'utf8')).version, name = 'Portable Tape Player-v' + version;
  const zip = await readFile(path.join(out(1), name + '.zip')), listed = (await readFile(path.join(out(1), name + '-files.txt'), 'utf8')).split('\n').filter(Boolean);
  // Read the ZIP back from its directory, independently of the code that wrote it.
  const end = zip.length - 22, count = zip.readUInt16LE(end + 10); let at2 = zip.readUInt32LE(end + 16); const inside = {};
  for (let i = 0; i < count; i++) {
    const packed = zip.readUInt32LE(at2 + 20), nameLength = zip.readUInt16LE(at2 + 28), offset = zip.readUInt32LE(at2 + 42), file = zip.subarray(at2 + 46, at2 + 46 + nameLength).toString();
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    inside[file] = createHash('sha256').update(inflateRawSync(zip.subarray(start, start + packed))).digest('hex');
    at2 += 46 + nameLength + zip.readUInt16LE(at2 + 30) + zip.readUInt16LE(at2 + 32);
  }
  assert.deepEqual(Object.keys(inside).sort(), listed.map(f => name + '/' + f).sort(), 'the ZIP holds exactly the listed files, under one folder');
  for (const f of listed) assert.equal(inside[name + '/' + f], createHash('sha256').update(await readFile(at(f))).digest('hex'), f + ' is intact in the ZIP');
  for (const must of ['README.md', 'edit/Portable Tape Player.blend', 'view/index.html', 'view/geometry/model.js', 'publish/github/confirmation.yml', 'publish/github/three-versions.png', 'rebuild/package-lock.json']) assert(listed.includes(must), must + ' ships');
  assert(!listed.some(f => /(^|\/)\.|node_modules|rebuild\/build\//.test(f)), 'no hidden file, no scratch folder');
  // Things lying about in the folder stay out, and do not change the ZIP.
  await writeFile(at('.hidden-note'), 'x'); await writeFile(at('edit/Portable Tape Player.blend1'), 'x'); await writeFile(at('old.zip'), 'x'); await mkdir(at('.git')); await writeFile(at('.git/config'), 'x');
  const second = release(out(2));
  assert.equal(second.status, 0, second.stderr); assert.match(second.stdout, /Left out/);
  assert((await readFile(path.join(out(2), name + '.zip'))).equals(zip), 'the same files give the same ZIP, byte for byte');
  for (const f of ['.hidden-note', 'edit/Portable Tape Player.blend1', 'old.zip', '.git']) await rm(at(f), {recursive: true});
  // A text file that names a home folder stops the release.
  await writeFile(at('publish/note.md'), 'saved to /' + 'Users/someone/Desktop\n');
  const leak = release(out(3));
  assert.notEqual(leak.status, 0); assert.match(leak.stderr, /publish\/note\.md contains a home-folder path/); assert(!(await access(path.join(out(3), name + '.zip')).then(() => true, () => false)), 'no ZIP is made');
  await rm(at('publish/note.md'));
  // An output folder inside the kit would be packed into the next ZIP.
  const inside2 = release(at('out'));
  assert.notEqual(inside2.status, 0); assert.match(inside2.stderr, /output folder is inside the kit/);
  done.push('the release tool needs no git, ships exactly the kit, is repeatable, and refuses a file that names a home folder or an output folder inside the kit');

  // 7. A target edit shows in the change report; an assessment counts only after accept and only while its target stands.
  await edit('edit/targets.json', s => { const f = JSON.parse(s); f.targets.find(t => t.id === 'body.height').tol = 3; f.targets.push({id: 'scratch.capstan_length', value: 23.1, tol: 0.1, unit: 'mm', class: 'measured', basis: 'made up for this check', measure: {size_of: 'BAY-052', along: 'depth'}}); return JSON.stringify(f, null, 1) + '\n'; });
  await edit('edit/assessments.json', s => { const f = JSON.parse(s); f.checklists['BAY-052'] = {features: ['length'], reviewed: 'this check'}; f.assessments.push({id: 'A-9001', part: 'BAY-052', feature: 'length', level: 4, target: 'scratch.capstan_length', issues: [1]}); return JSON.stringify(f, null, 1) + '\n'; });
  assert.equal(run('build.mjs', ['--viewer']).status, 0);
  let report = run('test.mjs', ['stale']).stdout;
  assert.match(report, /target body\.height: redefined/); assert.match(report, /BAY-052: required features changed/); assert.match(report, /target scratch\.capstan_length: new \(pass\)/);
  assert.equal((await masterRow('BAY-052')).confirmation_level, '1', 'not accepted yet, so still level 1');
  assert.match(JSON.stringify((await json('view/assessment-results.json')).rows['BAY-052']), /not yet accepted/);
  const accepted = run('accept.mjs');
  assert.equal(accepted.status, 0, accepted.stderr); assert.match(accepted.stdout, /Tied 1 new assessment/);
  assert.equal((await masterRow('BAY-052')).confirmation_level, '4'); assert.equal((await masterRow('BAY-052')).features_confirmed, '1 of 1');
  assert((await json('edit/assessments.json')).assessments[0].bound_to.parts['BAY-052'].shape, 'the assessment now carries the part\'s fingerprints');
  assert.match(run('test.mjs', ['stale']).stdout, /The model matches the accepted state/);
  // Redefine the target: the level falls back by itself and the change is reported.
  await edit('edit/targets.json', s => { const f = JSON.parse(s); f.targets.find(t => t.id === 'scratch.capstan_length').tol = 0.2; return JSON.stringify(f, null, 1) + '\n'; });
  assert.equal(run('build.mjs', ['--viewer']).status, 0);
  assert.equal((await masterRow('BAY-052')).confirmation_level, '1');
  report = run('test.mjs', ['stale']).stdout;
  assert.match(report, /BAY-052: confirmation level 4 → 1/); assert.match(report, /target scratch\.capstan_length: redefined/);
  assert.match(JSON.stringify((await json('view/assessment-results.json')).rows['BAY-052']), /was redefined since this was accepted/);
  // Accepting again does not quietly re-tie it: that takes a deliberate review (deleting bound_to).
  assert.equal(run('accept.mjs').status, 0); assert.equal((await masterRow('BAY-052')).confirmation_level, '1');
  done.push('an assessment raises a level only after accept, and falls back when its target is redefined');

  for (const line of done) console.log('ok    ' + line);
  console.log('\nThe build rules hold. The scratch copy was removed.');
} finally { for (const folder of [scratch, ...[1, 2, 3].map(n => scratch + '-zip-' + n)]) await rm(folder, {recursive: true, force: true}); }
