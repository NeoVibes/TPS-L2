// npm test            Rules, then every test, then what has changed since the accepted state.
// npm test -- name    Only tests whose file name contains "name".
//
// Three kinds of check:
//   rules            what any valid kit must satisfy (tools/check.mjs). A failure is an error.
//   tests            the viewer's own logic and how it uses the model's data. A failure is an error.
//   reference tests  numbers that belong to the shipped model (tests/reference/). They apply while the
//                    model is that model, and step aside once you have deliberately changed it.
import {spawnSync} from 'node:child_process';
import {readFile, readdir, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {ROOT, VIEW, WORK, requireNode} from './integrity.mjs';
import {checkKit} from './check.mjs';
import {fingerprintView, describeChanges} from './compare.mjs';

requireNode();
const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
const readState = async file => JSON.parse(await readFile(path.join(ROOT, file), 'utf8'));
let failed = false;

// 1. Rules.
const {errors, warnings, facts} = await checkKit();
for (const line of errors) console.log('RULE BROKEN  ' + line);
for (const line of warnings) console.log('WARNING      ' + line);
if (errors.length) { console.log('\nThe kit breaks ' + errors.length + ' rule' + (errors.length === 1 ? '' : 's') + '. Tests were not run.'); process.exit(1); }
console.log('Rules pass: ' + facts.parts + ' parts, ' + facts.catalogue_entries + ' service-manual entries.');

// 2. Compare the build with the shipped reference model and with the accepted state.
const now = await fingerprintView(VIEW);
const sinceReference = describeChanges(await readState('tests/reference/reference-model.json'), now);
const sinceAccepted = describeChanges(await readState('accepted.json'), now);

// 3. Tests. Most read the build's working files, which a fresh download does not have.
const listTests = async folder => (await readdir(path.join(ROOT, folder))).filter(n => /^test_.*\.mjs$/.test(n) && n !== 'test_setup.mjs').sort().map(n => folder + '/' + n);
const all = [...await listTests('tests'), ...await listTests('tests/reference')].filter(t => !only.length || only.some(o => t.includes(o)));
const skipped = {reference: [], working: [], parts: []}, results = [];
await mkdir(path.join(WORK, 'test-results'), {recursive: true});
for (const test of all) {
  if (test.startsWith('tests/reference/') && sinceReference.length) { skipped.reference.push(test); continue; }
  const source = await readFile(path.join(ROOT, test), 'utf8');
  if (!facts.working_files && /build\/(exports|viewer-data)/.test(source)) { skipped.working.push(test); continue; }
  // A test about particular parts says so in a "// needs-parts:" line and steps aside when one of them has been removed.
  const gone = (source.match(/^\/\/ needs-parts: (.+)$/m)?.[1].split(/\s+/) || []).filter(id => !(id in now.parts));
  if (gone.length) { skipped.parts.push(path.basename(test) + ' (' + gone.join(', ') + ')'); continue; }
  const run = spawnSync(process.execPath, [path.join(ROOT, test)], {cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 ** 2});
  const ok = run.status === 0;
  await writeFile(path.join(WORK, 'test-results', path.basename(test) + '.log'), (run.stdout || '') + (run.stderr || ''));
  results.push({test, ok});
  if (!ok) { failed = true; console.log('FAILED       ' + test + '\n' + ((run.stderr || run.stdout || '').split('\n').filter(l => /Error|assert/i.test(l)).slice(0, 3).map(l => '             ' + l.trim().slice(0, 200)).join('\n'))); }
}
console.log(results.filter(r => r.ok).length + ' of ' + results.length + ' tests pass.' + (failed ? ' Logs are in rebuild/build/test-results/.' : ''));
if (skipped.working.length) console.log(skipped.working.length + ' tests were not run because the build\'s working files are ' + (facts.out_of_date?.length ? 'out of date' : 'not here') + '. Run npm run build (needs Blender) to run them.');
if (skipped.parts.length) console.log(skipped.parts.length + ' test' + (skipped.parts.length === 1 ? ' was' : 's were') + ' not run because this model no longer has the parts they are about: ' + skipped.parts.join('; ') + '.');
if (skipped.reference.length) console.log(skipped.reference.length + ' reference tests were not run: they hold numbers of the shipped model, and this model differs from it in ' + sinceReference.length + ' place' + (sinceReference.length === 1 ? '' : 's') + '.');

// 4. What changed.
if (sinceAccepted.length) {
  console.log('\nChanged since the accepted state:');
  for (const line of sinceAccepted.slice(0, 40)) console.log('  ' + line);
  if (sinceAccepted.length > 40) console.log('  … and ' + (sinceAccepted.length - 40) + ' more');
  console.log('If this is what you meant, run npm run accept.');
} else console.log('The model matches the accepted state.');
process.exitCode = failed ? 1 : 0;
