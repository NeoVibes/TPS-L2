// Reuse mutations exercise the real builder in a disposable kit, never the checkout.
import assert from 'node:assert/strict';
import {cp, mkdtemp, realpath, readFile, writeFile, rm, symlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {KIT, ROOT, hash} from '../tools/integrity.mjs';

if (!process.env.PTP_INTEGRITY_FIXTURE) {
  const fixture = await mkdtemp(path.join(await realpath(tmpdir()), 'ptp-integrity-'));
  try {
    await cp(KIT, fixture, {recursive: true, filter: p => !['.git', 'node_modules', 'build', '.ptp-build.lock'].includes(path.basename(p)) && !path.basename(p).startsWith('.view.')});
    await cp(path.join(ROOT, 'node_modules'), path.join(fixture, 'rebuild/node_modules'), {recursive: true});
    const result = spawnSync(process.execPath, [path.join(fixture, 'rebuild/tests/test_build_integrity.mjs')], {env: {...process.env, PTP_INTEGRITY_FIXTURE: '1'}, encoding: 'utf8', maxBuffer: 4 * 1024 ** 2});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    process.stdout.write(result.stdout);
  } finally { await rm(fixture, {recursive: true, force: true}); }
} else {
  const {buildView} = await import('../tools/build.mjs');
  const {validateView, outputManifest} = await import('../tools/view-integrity.mjs');
  const view = path.join(KIT, 'view'), geometry = path.join(view, 'geometry');
  const original = await readFile(path.join(geometry, 'model.js'));
  const recordBytes = await readFile(path.join(view, 'build-record.json'));
  const record = JSON.parse(recordBytes);
  const geometryRecord = () => Object.fromEntries(Object.entries(record.outputs).filter(([p]) => p.startsWith('geometry/')));
  const rejected = async (message, options) => {
    const before = await outputManifest(view);
    await assert.rejects(() => buildView(true, options), message);
    assert.deepEqual(await outputManifest(view), before, 'rejection preserves every live byte');
  };
  const text = original.toString(), start = text.indexOf(','), end = text.lastIndexOf(')');
  for (const mutate of [data => { data.meta.parts[0].name += ' altered'; }, data => {
    const part = data.meta.parts.find(part => part.poses && Object.keys(part.poses).length);
    assert.ok(part, 'fixture has actual part poses');
    Object.values(part.poses)[0][0][0] += .25;
  }]) {
    const data = JSON.parse(text.slice(start + 1, end)); mutate(data);
    await writeFile(path.join(geometry, 'model.js'), text.slice(0, start + 1) + JSON.stringify(data) + text.slice(end));
    await rejected(/changed after/);
    await writeFile(path.join(geometry, 'model.js'), original);
  }
  for (const name of Object.keys(geometryRecord()).filter(p => p !== 'geometry/model.js')) {
    const file = path.join(view, name), bytes = await readFile(file);
    await writeFile(file, Buffer.concat([bytes, Buffer.from(' ')]));
    await rejected(/changed after/);
    await writeFile(file, bytes);
  }
  await writeFile(path.join(geometry, 'extra.js'), 'extra');
  await rejected(/inventory/); await rm(path.join(geometry, 'extra.js'));
  await rm(path.join(geometry, 'model.js'));
  await rejected(/inventory/); await writeFile(path.join(geometry, 'model.js'), original);
  await rejected(/changed after/, {hooks: {afterGeometryCopied: async stage => writeFile(path.join(stage, 'geometry/model.js'), 'corrupted staged copy')}});
  const source = path.join(ROOT, 'viewer/app.js'), sourceBytes = await readFile(source);
  await writeFile(source, Buffer.concat([sourceBytes, Buffer.from('\n// expected source edit\n')]));
  await buildView(true);
  assert.deepEqual(Object.fromEntries(Object.entries(JSON.parse(await readFile(path.join(view, 'build-record.json'))).outputs).filter(([p]) => p.startsWith('geometry/'))), geometryRecord());
  await writeFile(source, sourceBytes);
  await rejected(/inputs changed/, {hooks: {beforeCommit: async () => writeFile(source, Buffer.concat([sourceBytes, Buffer.from('\n// concurrent edit\n')]))}});
  await writeFile(source, sourceBytes);
  const modelInput = path.join(ROOT, 'tools/export_model.py'), modelBytes = await readFile(modelInput);
  await writeFile(modelInput, Buffer.concat([modelBytes, Buffer.from('\n# model export edit\n')]));
  await rejected(/Full build required/); await writeFile(modelInput, modelBytes);
  for (const name of ['service-manual-parts.csv', 'targets.json', 'assessments.json']) {
    const file = path.join(KIT, 'edit', name), bytes = await readFile(file);
    await writeFile(file, Buffer.concat([bytes, Buffer.from('\n')]));
    await buildView(true); await validateView(view);
    await writeFile(file, bytes);
  }
  // A manifest cannot omit package files, invent traversal paths, or bless a link.
  const fresh = JSON.parse(await readFile(path.join(view, 'build-record.json')));
  const packageName = Object.keys(geometryRecord()).find(p => p !== 'geometry/model.js');
  const omitted = structuredClone(fresh); delete omitted.outputs[packageName];
  await assert.rejects(() => validateView(view, {record: omitted}), /inventory/);
  const traversal = structuredClone(fresh); traversal.outputs['../outside'] = fresh.outputs['index.html'];
  await assert.rejects(() => validateView(view, {record: traversal}), /Unsafe/);
  const withoutPage = structuredClone(fresh); delete withoutPage.outputs['index.html'];
  await assert.rejects(() => validateView(view, {record: withoutPage}), /must include index/);
  // An external page asset cannot disappear together with its manifest entry. Legacy output
  // without a bootstrap reference must still validate, independent of the record's version.
  const bootstrapFile = path.join(view, 'theme-init.js'), pageFile = path.join(view, 'index.html');
  const bootstrapBytes = await readFile(bootstrapFile), pageBytes = await readFile(pageFile);
  const withoutBootstrap = structuredClone(fresh); delete withoutBootstrap.outputs['theme-init.js'];
  try {
    await rm(bootstrapFile);
    await assert.rejects(() => validateView(view, {record: withoutBootstrap}), /must include theme-init\.js referenced by index\.html/);
    const legacyPage = pageBytes.toString().replace('<script src="theme-init.js"></script>', '');
    assert.notEqual(legacyPage, pageBytes.toString(), 'The fixture must remove the actual bootstrap reference');
    await writeFile(pageFile, legacyPage);
    const legacyRecord = structuredClone(withoutBootstrap);
    legacyRecord.outputs['index.html'] = {sha256: hash(legacyPage), bytes: Buffer.byteLength(legacyPage)};
    await validateView(view, {record: legacyRecord});
  } finally {
    await writeFile(bootstrapFile, bootstrapBytes); await writeFile(pageFile, pageBytes);
  }
  const linked = path.join(view, 'linked.html');
  try { await symlink(path.join(view, 'index.html'), linked); await assert.rejects(() => validateView(view), /Links/); }
  catch (error) { if (process.platform !== 'win32' || error.code !== 'EPERM') throw error; }
  finally { await rm(linked, {force: true}); }
  console.log('Build integrity: metadata, poses, every package, inventory, copied bytes, source freshness and concurrent edits checked.');
}
