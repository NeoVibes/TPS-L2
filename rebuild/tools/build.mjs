// npm run build          The whole build: the Blender stages, then the page and its data files.
// npm run build:viewer   Only the page (index.html) and the lists beside it. The geometry files are kept as they are.
//
// A build either finishes with view/ matching the saved model, or fails and leaves the previous
// view/ untouched. New output is written to a staging folder, checked, and only then swapped in
// together with its build record.
import {spawn, spawnSync} from 'node:child_process';
import {readFile, writeFile, mkdir, rename, rm, readdir, access, cp} from 'node:fs/promises';
import path from 'node:path';
import {ROOT, KIT, VIEW, WORK, kitPath, hash, json, requireNode, modelInputs, exportOutputs, blenderStageGroups, checkSpace, inputChanges} from './integrity.mjs';
import {geometryFiles, pageFile} from './build_viewer.mjs';
import {readView, compareViews} from './compare.mjs';
import {confirmation, LEVELS} from './confirmation.mjs';
import {targetOutcome} from './targets.mjs';

const TESTED_BLENDER = '5.2';
const exists = p => access(p).then(() => true, () => false);
const seconds = since => ((Date.now() - since) / 1000).toFixed(1) + ' s';

/** Finds Blender: BLENDER_BIN, then PATH, then the usual install places. Needs 5.2 or newer. */
export async function findBlender() {
  const exe = process.platform === 'win32' ? 'blender.exe' : 'blender';
  const candidates = process.env.BLENDER_BIN ? [process.env.BLENDER_BIN] : (process.env.PATH || '').split(path.delimiter).map(p => path.join(p, exe));
  if (!process.env.BLENDER_BIN) {
    if (process.platform === 'darwin') candidates.push('/Applications/Blender.app/Contents/MacOS/Blender', path.join(process.env.HOME || '', 'Applications/Blender.app/Contents/MacOS/Blender'));
    if (process.platform === 'win32') for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
      const dir = path.join(root, 'Blender Foundation');
      try { for (const name of (await readdir(dir)).sort().reverse()) candidates.push(path.join(dir, name, exe)); } catch {}
    }
  }
  for (const executable of candidates) {
    if (!(await exists(executable))) continue;
    const probe = spawnSync(executable, ['--background', '--factory-startup', '--disable-autoexec', '--version'], {encoding: 'utf8'});
    const match = probe.stdout?.match(/Blender (\d+)\.(\d+)\.(\d+)/);
    if (probe.error || probe.status !== 0 || !match) continue;
    const version = match.slice(1).join('.'), series = match[1] + '.' + match[2];
    if (Number(match[1]) * 100 + Number(match[2]) < 502) throw Error('Blender ' + version + ' is too old. The model needs Blender ' + TESTED_BLENDER + ' or newer.');
    if (series !== TESTED_BLENDER) console.log('Note: this is Blender ' + version + '. The kit is tested with ' + TESTED_BLENDER + '; results may differ slightly, and the change report will show it.');
    return {executable, version};
  }
  throw Error('Blender was not found. Install Blender ' + TESTED_BLENDER + ' or newer, or set BLENDER_BIN to its executable.');
}

/** Runs the Blender stages into a staging folder and swaps it into build/exports/ when all succeed. */
async function runBlenderStages() {
  const blender = await findBlender(), config = await json('config/model.json'), inputs = await modelInputs();
  await checkSpace(768 * 1024 ** 2);
  const stage = path.join(WORK, 'exports.staging'), live = path.join(WORK, 'exports'), previous = path.join(WORK, 'exports.previous');
  await rm(stage, {recursive: true, force: true}); await mkdir(stage, {recursive: true});
  // Blender reads only what the stages ask for: no startup file, no add-ons, no scripts inside the model.
  const env = {...process.env, PTP_STAGE_OUT: stage, PTP_EXPECTED_NATIVE_SHA256: inputs[config.native], PYTHONDONTWRITEBYTECODE: '1'};
  const timings = {};
  // One stage: its own Blender, its output kept together and printed when it ends.
  const run = script => new Promise(resolve => {
    const started = Date.now(), said = [];
    const child = spawn(blender.executable, ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '2', '--python', path.join(ROOT, 'tools', script)], {cwd: ROOT, env});
    child.stdout.on('data', d => said.push(d)); child.stderr.on('data', d => said.push(d));
    child.on('error', () => resolve({script, failed: true, said, took: seconds(started)}));
    child.on('close', status => resolve({script, failed: status !== 0, said, took: seconds(started)}));
  });
  for (const group of blenderStageGroups()) {
    console.log('Blender ' + blender.version + ': ' + group.join(', '));
    const results = await Promise.all(group.map(run));
    for (const r of results) { process.stdout.write(Buffer.concat(r.said)); timings[r.script] = r.took; }
    const failed = results.filter(r => r.failed).map(r => r.script);
    if (failed.length) throw Error(failed.join(', ') + ' failed. The previous build is untouched; what this run produced is in ' + kitPath('build/exports.staging') + '.');
  }
  if (JSON.stringify(await modelInputs()) !== JSON.stringify(inputs)) throw Error('The model or a setting changed while the build was running. Save and run it again.');
  await rm(previous, {recursive: true, force: true});
  if (await exists(live)) await rename(live, previous);
  try { await rename(stage, live); } catch (error) { if (await exists(previous)) await rename(previous, live); throw error; }
  const receipt = {inputs, outputs: await exportOutputs(), toolchain: {blender: blender.version, node: process.version}, stage_seconds: timings};
  await writeFile(path.join(live, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  await rm(previous, {recursive: true, force: true});
  console.log('Blender stages: ' + Object.entries(timings).map(([k, v]) => k.replace('.py', '') + ' ' + v).join(', '));
  return receipt;
}

const keyed = (inputs) => Object.fromEntries(Object.entries(inputs).map(([p, h]) => [kitPath(p), h]));

/** Builds view/ in a staging folder, checks it, reports what changed, and swaps it in. */
async function buildView(viewerOnly) {
  const staging = path.join(KIT, 'view.staging'), previous = path.join(KIT, 'view.previous');
  await rm(staging, {recursive: true, force: true}); await mkdir(staging, {recursive: true});
  const oldRecord = await exists(path.join(VIEW, 'build-record.json')) ? JSON.parse(await readFile(path.join(VIEW, 'build-record.json'), 'utf8')) : null;
  const record = {what: 'Build record for this folder. Written by "npm run build" in rebuild/; checked by "npm test".'};
  record.version = (await json('config/release.json')).version;

  if (viewerOnly) {
    // The geometry files are reused, so the model, settings and export tools must be the ones they were built from.
    if (!oldRecord) throw Error('There is no earlier build to reuse. Run npm run build (needs Blender).');
    const changed = inputChanges(oldRecord.model_inputs, keyed(await modelInputs()));
    if (changed.length) throw Error('The geometry was built from a different model or settings: ' + changed.join(', ') + '. Run npm run build (needs Blender).');
    await cp(path.join(VIEW, 'geometry'), path.join(staging, 'geometry'), {recursive: true});
    record.built_with = {...oldRecord.built_with, node: process.version}; record.model_inputs = oldRecord.model_inputs;
  } else {
    const {writes, meta, packages} = await geometryFiles();
    for (const [relative, text] of writes) { const file = path.join(staging, relative); await mkdir(path.dirname(file), {recursive: true}); await writeFile(file, text); }
    const receipt = await json('build/exports/receipt.json');
    record.built_with = {blender: receipt.toolchain.blender, node: process.version}; record.model_inputs = keyed(receipt.inputs);
    // Working copies the tests read.
    await mkdir(path.join(WORK, 'viewer-data'), {recursive: true});
    await writeFile(path.join(WORK, 'viewer-data/model.json'), JSON.stringify(meta));
    await writeFile(path.join(WORK, 'viewer-data/packages.json'), JSON.stringify(packages, null, 2) + '\n');
  }
  // Read the staged geometry back the way the page would, and work out the lists that go beside the page:
  // the master parts list, the target reference and the assessment results.
  const view = await readView(staging);
  const lists = await confirmation(view, record.version);
  for (const [name, text] of Object.entries(lists.files)) await writeFile(path.join(staging, name), text);

  const page = await pageFile({masterParts: lists.files['master-parts.csv'], levels: LEVELS});
  await writeFile(path.join(staging, 'index.html'), page.html);
  record.viewer_inputs = keyed(page.inputs);
  record.dependencies = page.dependencies;

  const ids = view.meta.parts.map(p => p.id);
  if (new Set(ids).size !== ids.length) throw Error('Two parts share an ID in the built part list.');
  const serial = view.meta.fictional_serial, release = await json('config/release.json');
  if (!serial?.fictional || serial.value !== release.fictionalSerial) throw Error('The serial marking in the model (' + serial?.value + ') does not match config/release.json (' + release.fictionalSerial + ').');
  record.parts = ids.length;
  record.outputs = {};
  for (const relative of ['index.html', ...Object.keys(lists.files), 'geometry/model.js', ...Object.values(view.packageTable).map(p => 'geometry/' + p.file)].sort()) {
    const bytes = await readFile(path.join(staging, relative)); record.outputs[relative] = {sha256: hash(bytes), bytes: bytes.length};
  }
  await writeFile(path.join(staging, 'build-record.json'), JSON.stringify(record, null, 2) + '\n');

  // What this build changed, compared with the view/ it replaces.
  let report = null;
  if (await exists(path.join(VIEW, 'geometry/model.js'))) {
    try { report = await compareViews(VIEW, staging); } catch (error) { console.log('The previous view/ could not be read for comparison: ' + error.message); }
  }
  if (process.env.PTP_TEST_FAIL_BEFORE_SWAP) throw Error('Stopped before the swap, as asked by PTP_TEST_FAIL_BEFORE_SWAP.');

  await rm(previous, {recursive: true, force: true});
  if (await exists(VIEW)) await rename(VIEW, previous);
  try { await rename(staging, VIEW); } catch (error) { if (await exists(previous)) await rename(previous, VIEW); throw error; }
  await rm(previous, {recursive: true, force: true});
  return {record, report, lists};
}

/** One paragraph on what the lists say: how many rows, at what levels, and how the model compares with the targets. */
function printLists({rows, levels, checks, targetFile}) {
  const modelled = rows.filter(r => r.status === 'modelled'), count = {};
  for (const row of rows) { const level = levels.get(row.row_id).level; count[level] = (count[level] || 0) + 1; }
  const outcomes = {pass: 0, fail: 0, 'no check': 0, 'no data': 0};
  for (const t of targetFile.targets) outcomes[targetOutcome(checks, t.id).status]++;
  console.log('Wrote view/master-parts.csv: ' + modelled.length + ' modelled rows, ' + (rows.length - modelled.length) + ' service-manual entries not modelled. Confirmation levels: ' +
    Object.entries(count).map(([level, n]) => n + ' at level ' + level).join(', ') + '.');
  console.log('Wrote view/TARGETS.md: of ' + targetFile.targets.length + ' targets the model passes ' + outcomes.pass + ', fails ' + outcomes.fail + ', and ' + outcomes['no check'] + ' have no check yet' + (outcomes['no data'] ? ' (' + outcomes['no data'] + ' could not be checked)' : '') + '.');
}

function printChanges(report) {
  if (!report) return console.log('First build: nothing to compare with.');
  if (report.equivalent) return console.log('Compared with the previous build: no part, pose or control range changed.');
  const parts = new Set(report.differences.map(d => d.where.match(/^page\.(?:part|cassette|exterior)\.([^.]+)/)?.[1]).filter(Boolean));
  console.log('Compared with the previous build: ' + parts.size + ' part' + (parts.size === 1 ? '' : 's') + ' changed' + (report.differences.some(d => !d.where.startsWith('page.')) ? ', plus settings or control ranges' : '') + '.');
  for (const id of [...parts].slice(0, 30)) {
    const g = report.geometry[id];
    console.log('  ' + id + ': ' + (!g ? 'pose, name or other data' : g.topology ? 'shape (vertex or triangle layout changed)' : 'shape (moved up to ' + g.position_mm.toFixed(3) + ' mm, normals up to ' + g.normal_deg.toFixed(2) + '°)'));
  }
  for (const d of report.differences.filter(d => !d.where.startsWith('page.')).slice(0, 10)) console.log('  ' + d.where + ': ' + d.what);
}

if (process.argv[1]?.endsWith('build.mjs')) {
  requireNode();
  const viewerOnly = process.argv.includes('--viewer'), started = Date.now();
  try {
    if (!viewerOnly) await runBlenderStages();
    const {record, report, lists} = await buildView(viewerOnly);
    printChanges(report);
    printLists(lists);
    console.log('Built view/ (' + record.parts + ' parts) in ' + seconds(started) + '. Open view/index.html to look at it; run npm test to check it.');
  } catch (error) {
    await rm(path.join(KIT, 'view.staging'), {recursive: true, force: true});
    console.error('Build failed: ' + error.message);
    console.error((await exists(VIEW)) ? 'view/ is unchanged.' : 'There is no view/ yet.');
    process.exitCode = 1;
  }
}
