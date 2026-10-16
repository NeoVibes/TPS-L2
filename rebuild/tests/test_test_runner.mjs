import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseTestArguments, validateTestSuites, runTestSuite} from '../tools/test-suite.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'ptp-test-runner-'));
const output = path.join(root, 'logs');
try {
  await mkdir(path.join(root, 'tests/reference'), {recursive: true});
  // The fast fixture deliberately mentions an export path; text must never decide its suite.
  await writeFile(path.join(root, 'tests/test_fast.mjs'), "// build/exports/example.json\nconsole.log('executed fast');\n");
  await writeFile(path.join(root, 'tests/test_failure.mjs'), "console.error('intentional fixture failure'); process.exit(7);\n");
  await writeFile(path.join(root, 'tests/test_geometry.mjs'), "throw Error('missing prerequisites must skip this fixture');\n");
  await writeFile(path.join(root, 'tests/reference/test_reference.mjs'), "console.log('reference');\n");
  const manifest = [
    {file: 'tests/test_fast.mjs', suite: 'fast'},
    {file: 'tests/test_failure.mjs', suite: 'fast'},
    {file: 'tests/test_geometry.mjs', suite: 'geometry', workingFiles: true},
    {file: 'tests/reference/test_reference.mjs', suite: 'reference'},
  ];
  const run = options => runTestSuite(manifest, {root, output, ...options});
  let result = await run({filters: ['absent']});
  assert(result.failed); assert.equal(result.results.length, 0); assert.match(result.errors[0], /matched no tests/);
  result = await run({filters: ['test_fast', 'absent']});
  assert(result.failed); assert.equal(result.results.length, 1); assert(result.results[0].ok);
  result = await run({filters: ['test_geometry']});
  assert(result.failed); assert.match(result.errors[0], /only skipped tests/);
  assert.match(result.errors[0], /Blender working files are missing or out of date/);
  result = await run({filters: ['test_fast', 'test_geometry']});
  assert(result.failed); assert.equal(result.results.length, 1); assert.match(result.errors[0], /test_geometry.*only skipped/);
  result = await run({filters: ['test_fast', 'fast.mjs', 'test_fast']});
  assert(!result.failed); assert.equal(result.results.length, 1, 'Overlapping filters execute their union once');
  assert.equal(result.filterResults.length, 3); assert(result.filterResults.every(filter => filter.executable.length === 1));
  assert.match(await readFile(path.join(output, 'test_fast.mjs.log'), 'utf8'), /executed fast/);
  result = await run({filters: ['test_failure']});
  assert(result.failed); assert.equal(result.results[0].status, 7); assert.match(result.results[0].log, /intentional fixture failure/);
  result = await runTestSuite(manifest.filter(test => !test.file.includes('failure')), {root, output});
  assert(!result.failed, 'No-filter local runs retain expected geometry skips');
  assert.deepEqual(result.skipped.working, ['tests/test_geometry.mjs']);
  result = await run({suite: 'release', filters: ['test_fast', 'test_geometry']});
  assert(result.failed); assert(result.errors.some(error => /zero skipped/.test(error)));
  result = await run({filters: ['test_reference'], referenceChanged: true});
  assert(result.failed); assert.deepEqual(result.skipped.reference, ['tests/reference/test_reference.mjs']);
  assert.match(result.errors[0], /differs from the shipped reference/);
  result = await runTestSuite([{file: 'tests/test_fast.mjs', suite: 'fast', parts: ['NEEDED']}], {root, output, filters: ['test_fast']});
  assert(result.failed); assert.deepEqual(result.skipped.parts[0].missing, ['NEEDED']);
  assert.match(result.errors[0], /required parts are missing: NEEDED/);
  assert.deepEqual(parseTestArguments(['--suite=fast', 'one', 'two', 'one']), {suite: 'fast', filters: ['one', 'two']});
  assert.throws(() => parseTestArguments(['--suite']), /suite=fast/);
  assert.throws(() => parseTestArguments(['--misspelled']), /Unknown test option/);
  validateTestSuites(manifest, manifest.map(test => test.file));
  assert.throws(() => validateTestSuites(manifest, [...manifest.map(test => test.file), 'tests/test_new.mjs']), /no suite classification/);
  assert.throws(() => validateTestSuites([...manifest, manifest[0]], manifest.map(test => test.file)), /duplicate/);
  assert.throws(() => validateTestSuites(manifest, []), /Classified test is missing/);
  console.log('Test runner: per-filter execution, deduplicated union, explicit suites and strict release skips pass.');
} finally { await rm(root, {recursive: true, force: true}); }
