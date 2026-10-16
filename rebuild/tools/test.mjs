// npm test            Rules, then every test, then what has changed since the accepted state.
// npm test -- name    Only tests whose file name contains "name".
// npm test -- --suite=fast     Blender-free checks; no skips allowed.
// npm test -- --suite=release  All checks; no skips allowed.
//
// Three kinds of check:
//   rules            what any valid kit must satisfy (tools/check.mjs). A failure is an error.
//   tests            the viewer's own logic and how it uses the model's data. A failure is an error.
//   reference tests  numbers that belong to the shipped model (tests/reference/). They apply while the
//                    model is that model, and step aside once you have deliberately changed it.
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT, VIEW, WORK, requireNode} from './integrity.mjs';
import {checkKit} from './check.mjs';
import {fingerprintView, describeChanges} from './compare.mjs';
import {TEST_SUITES} from '../tests/suites.mjs';
import {parseTestArguments, discoverTests, validateTestSuites, runTestSuite} from './test-suite.mjs';

requireNode();
let options;
try {
  options = parseTestArguments(process.argv.slice(2));
  validateTestSuites(TEST_SUITES, await discoverTests(ROOT));
} catch (error) { console.error(error.message); process.exit(1); }
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

// 3. Prerequisites come from the suite manifest, not incidental strings in test source.
const run = await runTestSuite(TEST_SUITES, {root: ROOT, output: path.join(WORK, 'test-results'), ...options,
  workingFiles: facts.working_files, referenceChanged: sinceReference.length > 0, partIds: Object.keys(now.parts)});
const {results, skipped} = run;
failed = run.failed;
for (const error of run.errors) console.log('TEST REQUEST FAILED  ' + error);
for (const result of results) if (!result.ok) console.log('FAILED       ' + result.test + '\n' + result.log.split('\n').filter(l => /Error|assert/i.test(l)).slice(0, 3).map(l => '             ' + l.trim().slice(0, 200)).join('\n'));
await writeFile(path.join(WORK, 'test-results', 'summary.json'), JSON.stringify({suite: options.suite, filters: run.filterResults,
  passed: !failed, results: results.map(({log, ...result}) => result), skipped, errors: run.errors}, null, 2) + '\n');
console.log((results.length ? results.filter(r => r.ok).length + ' of ' + results.length + ' tests pass.' : 'No tests ran.') + (failed ? ' Logs are in rebuild/build/test-results/.' : ''));
if (skipped.working.length) console.log(skipped.working.length + ' tests were not run because the build\'s working files are ' + (facts.out_of_date?.length ? 'out of date' : 'not here') + '. Run npm run build (needs Blender) to run them.');
if (skipped.parts.length) console.log(skipped.parts.length + ' test' + (skipped.parts.length === 1 ? ' was' : 's were') + ' not run because this model no longer has the parts they are about: ' + skipped.parts.map(({file, missing}) => path.basename(file) + ' (' + missing.join(', ') + ')').join('; ') + '.');
if (skipped.reference.length) console.log(skipped.reference.length + ' reference tests were not run: they hold numbers of the shipped model, and this model differs from it in ' + sinceReference.length + ' place' + (sinceReference.length === 1 ? '' : 's') + '.');

// 4. What changed.
if (sinceAccepted.length) {
  console.log('\nChanged since the accepted state:');
  for (const line of sinceAccepted.slice(0, 40)) console.log('  ' + line);
  if (sinceAccepted.length > 40) console.log('  … and ' + (sinceAccepted.length - 40) + ' more');
  console.log('If this is what you meant, run npm run accept.');
} else console.log('The model matches the accepted state.');
process.exitCode = failed ? 1 : 0;
