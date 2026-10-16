import {spawnSync} from 'node:child_process';
import {mkdir, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

export function parseTestArguments(args) {
  const filters = [];
  let suite = 'all';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') continue;
    if (arg === '--suite' || arg.startsWith('--suite=')) {
      const value = arg === '--suite' ? args[++i] : arg.slice('--suite='.length);
      if (!['fast', 'release'].includes(value)) throw Error('Use --suite=fast or --suite=release.');
      if (suite !== 'all') throw Error('Choose one test suite.');
      suite = value;
    } else if (arg.startsWith('-')) throw Error('Unknown test option: ' + arg);
    else filters.push(arg);
  }
  return {suite, filters: [...new Set(filters)]};
}

export async function discoverTests(root) {
  const files = [];
  for (const folder of ['tests', 'tests/reference']) for (const name of await readdir(path.join(root, folder)))
    if (/^test_.*\.mjs$/.test(name) && name !== 'test_setup.mjs') files.push(folder + '/' + name);
  return files.sort();
}

export function validateTestSuites(manifest, discovered) {
  const files = manifest.map(test => test.file), seen = new Set(files), errors = [];
  if (seen.size !== files.length) errors.push('The suite manifest contains duplicate tests.');
  for (const file of discovered) if (!seen.has(file)) errors.push('Test has no suite classification: ' + file);
  for (const test of manifest) {
    if (!discovered.includes(test.file)) errors.push('Classified test is missing: ' + test.file);
    if (!['fast', 'geometry', 'reference'].includes(test.suite)) errors.push('Unknown suite for ' + test.file);
    if (test.suite === 'fast' && test.workingFiles) errors.push('A fast test cannot require Blender working files: ' + test.file);
  }
  if (errors.length) throw Error(errors.join('\n'));
}

/** Select a deduplicated union, retaining each explicit filter's independent outcome. */
export function selectTests(manifest, {filters = [], suite = 'all', workingFiles = false,
  referenceChanged = false, partIds = []} = {}) {
  const available = manifest.filter(test => suite !== 'fast' || test.suite === 'fast');
  const selected = available.filter(test => !filters.length || filters.some(filter => test.file.includes(filter)));
  const parts = new Set(partIds), runnable = [], skipped = {reference: [], working: [], parts: []};
  for (const test of selected) {
    if (test.suite === 'reference' && referenceChanged) skipped.reference.push(test.file);
    else if (test.workingFiles && !workingFiles) skipped.working.push(test.file);
    else {
      const missing = (test.parts || []).filter(id => !parts.has(id));
      if (missing.length) skipped.parts.push({file: test.file, missing});
      else runnable.push(test.file);
    }
  }
  const skipReasons = new Map([
    ...skipped.reference.map(file => [file, 'the current model differs from the shipped reference']),
    ...skipped.working.map(file => [file, 'current Blender working files are missing or out of date']),
    ...skipped.parts.map(({file, missing}) => [file, 'required parts are missing: ' + missing.join(', ')]),
  ]);
  const filterResults = filters.map(filter => {
    const matched = selected.filter(test => test.file.includes(filter)).map(test => test.file);
    const executable = runnable.filter(file => file.includes(filter));
    return {filter, matched, executable, skipped: matched.filter(file => skipReasons.has(file)).map(file => ({file, reason: skipReasons.get(file)}))};
  });
  const errors = filterResults.flatMap(({filter, matched, executable, skipped}) => !matched.length
    ? ['Filter "' + filter + '" matched no tests.'] : !executable.length
      ? ['Filter "' + filter + '" matched only skipped tests: ' + skipped.map(({file, reason}) => file + ' (' + reason + ')').join('; ') + '.'] : []);
  if (suite !== 'all' && Object.values(skipped).some(list => list.length)) errors.push('The ' + suite + ' suite requires zero skipped tests.');
  if (!runnable.length && !errors.length) errors.push('No tests were executed.');
  return {runnable, skipped, filterResults, errors};
}

/** Real child processes and logs are shared by the CLI and fixture-based runner tests. */
export async function runTestSuite(manifest, {root, output, ...selection}) {
  const plan = selectTests(manifest, selection), results = [];
  await mkdir(output, {recursive: true});
  for (const test of plan.runnable) {
    const run = spawnSync(process.execPath, [path.join(root, test)], {cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 ** 2});
    const log = (run.stdout || '') + (run.stderr || '') + (run.error ? run.error.message + '\n' : '');
    await writeFile(path.join(output, path.basename(test) + '.log'), log);
    results.push({test, ok: run.status === 0, status: run.status, log});
  }
  return {...plan, results, failed: plan.errors.length > 0 || results.some(result => !result.ok)};
}
