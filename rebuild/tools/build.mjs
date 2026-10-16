// npm run build          The whole build: the Blender stages, then the page and its data files.
// npm run build:viewer   Only the page (index.html) and the lists beside it. The geometry files are kept as they are.
//
// Output is verified before promotion. Failed promotion attempts roll back; cleanup after
// successful promotion is a warning, because the new output has already been committed.
import {readFile, writeFile, mkdir, access, cp} from 'node:fs/promises';
import path from 'node:path';
import {ROOT, KIT, VIEW, WORK, kitPath, hash, json, requireNode, modelInputs, exportOutputs, blenderStageGroups, checkSpace, inputChanges, captureInputs, assertInputsUnchanged} from './integrity.mjs';
import {geometryFiles, pageFile} from './build_viewer.mjs';
import {readView, compareViews} from './compare.mjs';
import {confirmation, LEVELS} from './confirmation.mjs';
import {targetOutcome} from './targets.mjs';

import {findBlender} from './blender.mjs';
export {findBlender} from './blender.mjs';
import {validateView} from './view-integrity.mjs';
import {createDirectoryTransaction, cleanupLeftovers} from './build-transaction.mjs';
import {acquireBuildLock} from './build-lock.mjs';
import {runManagedBlender} from './managed-blender.mjs';
const exists = p => access(p).then(() => true, () => false);
const seconds = since => ((Date.now() - since) / 1000).toFixed(1) + ' s';

/** Runs the Blender stages into a staging folder and swaps it into build/exports/ when all succeed. */
async function runBlenderStages(signal) {
  const blender = await findBlender(), config = await json('config/model.json'), inputs = await modelInputs();
  await checkSpace(768 * 1024 ** 2);
  await mkdir(WORK, {recursive: true});
  const live = path.join(WORK, 'exports');
  const exportCleanup = await cleanupLeftovers(live, {verify: async root => {
    const record = JSON.parse(await readFile(path.join(root, 'receipt.json'), 'utf8'));
    if (JSON.stringify(await exportOutputs(path.relative(ROOT, root).split(path.sep).join('/'))) !== JSON.stringify(record.outputs)) throw Error('Export inventory or hashes differ');
  }});
  for (const warning of exportCleanup.warnings) console.warn(warning);
  const transaction = await createDirectoryTransaction(live), {stage} = transaction;
  try {
    // Blender reads only what the stages ask for: no startup file, no add-ons, no scripts inside the model.
    const env = {...process.env, PTP_STAGE_OUT: stage, PTP_EXPECTED_NATIVE_SHA256: inputs[config.native], PYTHONDONTWRITEBYTECODE: '1'};
    const timings = {};
    // One stage: its own Blender, its output kept together and printed when it ends.
    const run = async script => {
      const started = Date.now(), said = [];
      const result = await runManagedBlender({executable: blender.executable, args: ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '2', '--python', path.join(ROOT, 'tools', script)], cwd: ROOT, env, signal, onStdout: d => said.push(Buffer.from(d)), onStderr: d => said.push(Buffer.from(d))});
      return {script, failed: result.code !== 0 || result.cancelled, said, took: seconds(started)};
    };
    for (const group of blenderStageGroups()) {
      console.log('Blender ' + blender.version + ': ' + group.join(', '));
      const settled = await Promise.allSettled(group.map(run));
      const results = settled.map((r, i) => r.status === 'fulfilled' ? r.value : {script: group[i], failed: true, preserveBuildLock: r.reason?.preserveBuildLock, said: [Buffer.from(String(r.reason))], took: 'failed'});
      for (const r of results) { process.stdout.write(Buffer.concat(r.said)); timings[r.script] = r.took; }
      const failed = results.filter(r => r.failed).map(r => r.script);
      if (failed.length) {
        const preserveBuildLock = results.some(r => r.preserveBuildLock);
        throw Object.assign(Error(failed.join(', ') + ' failed. ' + (preserveBuildLock ? 'Child shutdown is unconfirmed; preserve the lock and staged export for manual inspection.' : 'The staged export will be discarded.')), {preserveBuildLock});
      }
    }
    if (JSON.stringify(await modelInputs()) !== JSON.stringify(inputs)) throw Error('The model or a setting changed while the build was running. Save and run it again.');
    const receipt = {inputs, outputs: await exportOutputs(path.relative(ROOT, stage).split(path.sep).join('/')), toolchain: {blender: blender.version, node: process.version}, stage_seconds: timings};
    await writeFile(path.join(stage, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    if (signal?.aborted) throw Error('Build cancelled before export promotion.');
    for (const warning of (await transaction.commit()).warnings) console.warn(warning);
    console.log('Blender stages: ' + Object.entries(timings).map(([k, v]) => k.replace('.py', '') + ' ' + v).join(', '));
    return receipt;
  } catch (error) {
    if (error.unchanged !== false && !error.preserveBuildLock) await transaction.discard();
    throw error;
  }
}

const keyed = (inputs) => Object.fromEntries(Object.entries(inputs).map(([p, h]) => [kitPath(p), h]));

/** Builds view/ in a staging folder, checks it, reports what changed, and swaps it in. */
export async function buildView(viewerOnly, {captured, hooks = {}, signal} = {}) {
  captured ??= await captureInputs();
  for (const warning of (await cleanupLeftovers(VIEW, {verify: validateView})).warnings) console.warn(warning);
  const transaction = await createDirectoryTransaction(VIEW), staging = transaction.stage;
  try {
    const oldRecord = viewerOnly && await exists(path.join(VIEW, 'build-record.json')) ? JSON.parse(await readFile(path.join(VIEW, 'build-record.json'), 'utf8')) : null;
    const record = {what: 'Build record for this folder. Written by "npm run build" in rebuild/; checked by "npm test".'};
    record.version = (await json('config/release.json')).version;

    if (viewerOnly) {
      // The geometry files are reused, so the model, settings and export tools must be the ones they were built from.
      if (!oldRecord) throw Error('There is no earlier build to reuse. Run npm run build (needs Blender).');
      const changed = inputChanges(oldRecord.model_inputs, keyed(captured.model));
      if (changed.length) throw Error('Full build required: model or export inputs changed: ' + changed.join(', ') + '. Run npm run build (needs Blender).');
      await validateView(VIEW, {record: oldRecord, geometryOnly: true});
      await hooks.afterReuseVerified?.();
      await cp(path.join(VIEW, 'geometry'), path.join(staging, 'geometry'), {recursive: true});
      await hooks.afterGeometryCopied?.(staging);
      await validateView(staging, {record: oldRecord, geometryOnly: true});
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
    record.viewer_inputs = keyed(captured.viewer);
    record.dependencies = page.dependencies;

    const ids = view.meta.parts.map(p => p.id);
    if (new Set(ids).size !== ids.length) throw Error('Two parts share an ID in the built part list.');
    const serial = view.meta.fictional_serial, release = await json('config/release.json');
    if (!serial?.fictional || serial.value !== release.fictionalSerial) throw Error('The serial marking in the model (' + serial?.value + ') does not match config/release.json (' + release.fictionalSerial + ').');
    record.parts = ids.length;
    record.outputs = {};
    for (const relative of ['index.html', ...Object.keys(lists.files), 'geometry/model.js', ...Object.values(view.packageTable).map(p => 'geometry/' + p.file)].sort()) {
      if (viewerOnly && relative.startsWith('geometry/')) record.outputs[relative] = oldRecord.outputs[relative];
      else { const bytes = await readFile(path.join(staging, relative)); record.outputs[relative] = {sha256: hash(bytes), bytes: bytes.length}; }
    }
    await writeFile(path.join(staging, 'build-record.json'), JSON.stringify(record, null, 2) + '\n');
    await validateView(staging);

    // What this build changed, compared with the view/ it replaces.
    let report = null;
    if (await exists(path.join(VIEW, 'geometry/model.js'))) {
      try { report = await compareViews(VIEW, staging); } catch (error) { console.log('The previous view/ could not be read for comparison: ' + error.message); }
    }
    if (process.env.PTP_TEST_FAIL_BEFORE_SWAP) throw Error('Stopped before the swap, as asked by PTP_TEST_FAIL_BEFORE_SWAP.');
    await hooks.beforeCommit?.(staging);
    await assertInputsUnchanged(captured);
    if (JSON.stringify(record.model_inputs) !== JSON.stringify(keyed(captured.model)) || JSON.stringify(page.inputs) !== JSON.stringify(captured.viewer)) throw Error('Candidate output does not match the captured sources.');
    if (signal?.aborted) throw Error('Build cancelled before viewer promotion.');
    for (const warning of (await transaction.commit()).warnings) console.warn(warning);
    return {record, report, lists};
  } catch (error) {
    if (error.unchanged !== false) await transaction.discard();
    throw error;
  }
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
  let lock, preserveBuildLock = false;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try {
    lock = await acquireBuildLock(KIT);
    const captured = await captureInputs();
    if (!viewerOnly) await runBlenderStages(controller.signal);
    const {record, report, lists} = await buildView(viewerOnly, {captured, signal: controller.signal});
    printChanges(report);
    printLists(lists);
    console.log('Built view/ (' + record.parts + ' parts) in ' + seconds(started) + '. Open view/index.html to look at it; run npm test to check it.');
  } catch (error) {
    preserveBuildLock = !!error.preserveBuildLock;
    console.error('Build failed: ' + error.message);
    if (error.unchanged === false && error.live === VIEW) console.error('view/ could not be restored. Preserve the backup paths reported above; restore them manually or use git restore view/.');
    else console.error((await exists(VIEW)) ? 'view/ is unchanged.' : 'There is no view/ yet.');
    process.exitCode = 1;
  } finally {
    if (!preserveBuildLock) try { await lock?.release(); }
    catch (error) { console.warn('Build lock cleanup failed: ' + error.message + '. Inspect ' + lock.path + ' before the next build.'); }
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  }
}
