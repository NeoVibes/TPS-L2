// Paths and small checks shared by the build tools and the tests.
//
// ROOT is rebuild/ (tools, viewer source, settings, tests). KIT is the folder above it.
// WORK is rebuild/build/: scratch files the build recreates; it is never shipped.
import {readFile, readdir, lstat, realpath, statfs} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const KIT = path.dirname(ROOT);
export const VIEW = path.join(KIT, 'view');
export const WORK = path.join(ROOT, 'build');
export const kitPath = relative => path.relative(KIT, path.resolve(ROOT, relative)).split(path.sep).join('/');   // 'config/x' → 'rebuild/config/x'

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// The lists people maintain, relative to rebuild/.
export const SERVICE_PARTS_CSV = '../edit/service-manual-parts.csv', TARGETS = '../edit/targets.json', ASSESSMENTS = '../edit/assessments.json';
/** The service-manual parts list as catalogue entries. */
export async function serviceCatalog() {
  const {parseServiceCatalog} = await import('../viewer/service-catalog.mjs');
  return parseServiceCatalog(await readFile(path.join(ROOT, SERVICE_PARTS_CSV), 'utf8'));
}

export async function json(relative) {
  try { return JSON.parse(await readFile(path.join(ROOT, relative), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') throw Error('Missing ' + kitPath(relative) + '. Restore it from the kit, or run npm run build if it is a build file.'); throw error; }
}

export function requireNode() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Node 24 or newer is required.');
}

/** SHA-256 of a file named relative to rebuild/. The file must be a real file inside the kit. */
export async function fileHash(relative) {
  const p = path.resolve(ROOT, relative);
  if (!p.startsWith(KIT + path.sep)) throw Error('File is outside the kit: ' + relative);
  let info;
  try { info = await lstat(p); } catch (error) { if (error.code === 'ENOENT') throw Error('Missing ' + kitPath(relative) + '. Restore it from the kit, or run npm run build if it is a build file.'); throw error; }
  if (info.isSymbolicLink() || await realpath(p) !== p) throw Error('Links are not allowed in the kit: ' + relative);
  return hash(await readFile(p));
}

/** Every file under a folder (relative to rebuild/), sorted. */
export async function walk(folder) {
  const result = [];
  async function visit(rel) {
    for (const entry of await readdir(path.join(ROOT, rel), {withFileTypes: true})) {
      if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue;   // left by file browsers; never shipped
      const p = path.posix.join(rel, entry.name);
      if (entry.isSymbolicLink()) throw Error('Links are not allowed in the kit: ' + p);
      if (entry.isDirectory()) await visit(p); else if (entry.isFile()) result.push(p); else throw Error('Unsupported file type: ' + p);
    }
  }
  await visit(folder);
  return result.sort();
}

// The Blender stages, in the order they must finish. The stages of one group read only what earlier groups wrote,
// and write files of their own, so a group runs side by side. Two at a time keeps the build within about 3 GB of memory.
const BLENDER_STAGE_GROUPS = [['export_model.py'], ['measure_parts.py', 'native_regression.py'], ['pack_geometry.py', 'export_cassette.py'], ['measure_targets.py']];
const BLENDER_STAGES = BLENDER_STAGE_GROUPS.flat();
const BLENDER_HELPERS = ['part_schema.py', 'build_io.py', 'motion_samples.py', 'belt_geometry.py', 'solid_measure.py'];
export const blenderStageGroups = () => BLENDER_STAGE_GROUPS.map(group => [...group]);

/** Files that decide what the Blender stages produce: the model, the settings and the Blender scripts. */
export async function modelInputs() {
  const config = await json('config/model.json');
  // The release wording and version (config/release.json) are not here: they only affect the page.
  const paths = [config.native, 'config/model.json', 'config/part-ids.json', ...[...BLENDER_STAGES, ...BLENDER_HELPERS].map(p => 'tools/' + p)];
  return Object.fromEntries(await Promise.all(paths.sort().map(async p => [p, await fileHash(p)])));
}

/** Files that decide what the page and the lists beside it contain: the viewer source, the settings, and the targets, assessments and service list. */
export async function viewerInputs() {
  const paths = [...(await walk('viewer')), 'package.json', 'package-lock.json', 'config/model.json', 'config/release.json', 'tools/build_viewer.mjs', 'tools/targets.mjs', 'tools/confirmation.mjs', 'tools/compare.mjs', SERVICE_PARTS_CSV, TARGETS, ASSESSMENTS];
  return Object.fromEntries(await Promise.all(paths.sort().map(async p => [p, await fileHash(p)])));
}

/** The build dependencies: the versions the lock file asks for and the versions actually installed (null if not installed). */
export async function dependencyVersions() {
  const lock = (await json('package-lock.json')).packages, result = {};
  for (const name of Object.keys(lock[''].dependencies)) {
    let installed = null; try { installed = (await json('node_modules/' + name + '/package.json')).version; } catch {}
    result[name] = {locked: lock['node_modules/' + name].version, installed};
  }
  return result;
}

/** What differs between the inputs a build recorded and the inputs now: files added, removed or changed. */
export function inputChanges(recorded, current) {
  recorded ||= {};
  const changes = [];
  for (const p of Object.keys(current)) if (!(p in recorded)) changes.push(p + ' (new)');
  for (const [p, h] of Object.entries(recorded)) { if (!(p in current)) changes.push(p + ' (removed)'); else if (current[p] !== h) changes.push(p + ' (changed)'); }
  return changes.sort();
}

export async function exportOutputs(folder = 'build/exports') {
  const paths = (await walk(folder)).filter(p => p !== folder + '/receipt.json');
  return Object.fromEntries(await Promise.all(paths.map(async p => ['build/exports/' + p.slice(folder.length + 1), await fileHash(p)])));
}

/** Capture before work starts, and compare again before promoting output. */
export async function captureInputs() {
  return {model: await modelInputs(), viewer: await viewerInputs(), dependencies: await dependencyVersions()};
}

export async function assertInputsUnchanged(captured) {
  if (JSON.stringify(captured) !== JSON.stringify(await captureInputs())) throw Error('Build inputs changed while the build was running. Save the files and run the build again.');
}

export async function checkSpace(bytes) {
  const fs = await statfs(ROOT), free = Number(fs.bavail) * Number(fs.bsize);
  if (free < bytes) throw Error('Need ' + bytes.toLocaleString() + ' more bytes of disk space; only ' + free.toLocaleString() + ' are free.');
}

/** True when the build's working files exist. They are absent in a fresh download. */
export async function haveWorkingFiles() {
  try { await lstat(path.join(WORK, 'exports/receipt.json')); return true; } catch { return false; }
}

/** Confirms the working files in build/exports/ belong to the current model, settings and tools. */
export async function verifyExports() {
  requireNode();
  let receipt;
  try { receipt = await json('build/exports/receipt.json'); } catch { throw Error('The build\'s working files are missing. Run npm run build (needs Blender).'); }
  const current = await modelInputs();
  for (const [p, h] of Object.entries(current)) if (receipt.inputs[p] !== h) throw Error('Out of date: ' + kitPath(p) + ' changed since the last build. Run npm run build.');
  if (JSON.stringify(Object.keys(current)) !== JSON.stringify(Object.keys(receipt.inputs))) throw Error('The set of build inputs changed. Run npm run build.');
  const outputs = await exportOutputs();
  if (JSON.stringify(outputs) !== JSON.stringify(receipt.outputs)) throw Error('A working file is missing or was modified. Run npm run build.');
  const config = await json('config/model.json'), model = await json('build/exports/model.json'), inventory = await json('build/exports/inventory.json');
  if (model.source_sha256 !== current[config.native] || inventory.native_sha256 !== current[config.native] || model.inventory.sha256 !== outputs['build/exports/inventory.json'])
    throw Error('The working files do not belong to this Blender file. Run npm run build.');
  return {receipt, model, inventory, config};
}
