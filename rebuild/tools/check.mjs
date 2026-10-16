// The rules any valid kit must pass. Used by "npm test" and before "npm run accept".
//
// Errors mean the kit is broken. Warnings mean view/ is older than the model or the viewer source:
// it still works, but it does not show the latest edit until "npm run build" has been run.
import {readFile, lstat, readdir} from 'node:fs/promises';
import path from 'node:path';
import {ROOT, VIEW, json, kitPath, walk, modelInputs, viewerInputs, dependencyVersions, inputChanges, haveWorkingFiles, verifyExports, serviceCatalog, SERVICE_PARTS_CSV, TARGETS, ASSESSMENTS} from './integrity.mjs';
import {validateServiceCatalog} from '../viewer/part-information.mjs';
import {computerPathsIn} from './blend_file.mjs';
import {targetProblems} from './targets.mjs';
import {listRows, assessmentProblems, versionProblems} from './confirmation.mjs';
import {validateView} from './view-integrity.mjs';

export async function checkKit() {
  const errors = [], warnings = [], facts = {};
  const rule = async (label, body) => { try { await body(); } catch (error) { errors.push(label + ': ' + error.message); } };

  let record, view;
  await rule('build record', async () => {
    ({record, view} = await validateView(VIEW));
  });
  if (!view || !record) return {errors, warnings, facts};

  const ids = view.meta.parts.map(p => p.id), registry = (await json('config/part-ids.json')).records, config = await json('config/model.json');
  const issued = registry.map(r => r.id), retired = new Set(registry.filter(r => r.state_at_registration === 'retired-reserved').map(r => r.id));
  facts.parts = ids.length; facts.issued_ids = issued.length;
  await rule('part IDs', async () => {
    if (new Set(ids).size !== ids.length) throw Error('two parts share an ID');
    if (new Set(issued).size !== issued.length) throw Error('the ID list (config/part-ids.json) repeats an ID');
    for (const id of ids) { if (!issued.includes(id)) throw Error(id + ' is not in the ID list; issue it with the editing helper'); if (retired.has(id)) throw Error(id + ' was retired and cannot be used again'); }
  });
  await rule('serial marking', async () => {
    const release = await json('config/release.json'), serial = view.meta.fictional_serial;
    const offered = view.meta.exterior?.versions || [], labelled = (release.exteriors || []).map(e => e.id);
    if (JSON.stringify(offered) !== JSON.stringify(labelled)) throw Error('the exterior versions in the Blender file (' + offered.join(', ') + ') and the labels in config/release.json (' + labelled.join(', ') + ') must be the same, in the same order');
    if ((release.exteriors || []).some(e => !e.label || !e.lettering || !e.serials)) throw Error('every exterior version in config/release.json needs a label, its lettering and a serial range');
    if (release.repository && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(release.repository)) throw Error('"repository" in config/release.json must be empty or a GitHub repository address (https://github.com/owner/name)');
    if (!serial?.fictional || serial.value !== release.fictionalSerial) throw Error('the fictional serial marking is missing or altered');
  });
  await rule('service catalogue', async () => {
    const catalog = await serviceCatalog();
    validateServiceCatalog(catalog, issued);
    facts.catalogue_entries = catalog.length;
    facts.catalogue_entries_naming_missing_parts = catalog.flatMap(e => e.partIds.filter(id => !ids.includes(id)).map(id => e.id + ' → ' + id));
  });
  // The targets and assessments must be sound, and the results beside the page must have been worked out from them.
  let results = null;
  await rule('targets and assessments', async () => {
    const targetFile = await json(TARGETS), file = await json(ASSESSMENTS);
    const problems = [...targetProblems(targetFile, ids), ...versionProblems(targetFile, view.meta), ...(view.measured ? assessmentProblems(file, listRows(view, await serviceCatalog()), targetFile) : [])];
    if (problems.length) throw Error(problems.join('; '));
    facts.targets = targetFile.targets.length; facts.assessments = file.assessments.length;
  });
  await rule('assessment results', async () => {
    results = JSON.parse(await readFile(path.join(VIEW, 'assessment-results.json'), 'utf8'));
    if (results.bound_to.model !== view.meta.source_sha256) throw Error('view/assessment-results.json was worked out from a different model than the geometry beside it');
    for (const [key, file] of [['targets', TARGETS], ['assessments', ASSESSMENTS], ['service_list', SERVICE_PARTS_CSV]])
      if (results.bound_to[key] !== record.viewer_inputs[kitPath(file)]) throw Error('view/assessment-results.json was not worked out from the ' + kitPath(file) + ' this build used');
  });
  // The kit describes itself as it is now. Notes about earlier versions belong in release notes, not in its files.
  await rule('current version only', async () => {
    const current = 'v' + (await json('config/release.json')).version, places = ['..', '../edit', '../publish', '../publish/github', '../publish/walkthrough', 'tools', 'viewer', 'config', 'tests', 'tests/reference'];
    for (const folder of places) for (const p of await readdir(path.join(ROOT, folder)).catch(() => [])) {
      if (!/\.(md|mjs|js|py|json|csv|html|css|yml|txt)$/.test(p) || p === 'package-lock.json') continue;
      const other = [...new Set((await readFile(path.join(ROOT, folder, p), 'utf8')).match(/\bv0\.\d+(?:\.\d+)?\b/g) || [])].filter(v => v !== current);
      if (other.length) throw Error(kitPath(path.posix.join(folder, p)) + ' names ' + other.join(', ') + '; the kit holds the current version (' + current + ') only');
    }
  });
  await rule('portable sources', async () => {
    for (const p of [...await walk('viewer'), ...await walk('tools'), ...await walk('config')]) {
      if (!/\.(mjs|js|py|json|html)$/.test(p)) continue;
      if (/\/Users\/|[A-Z]:\\\\Users\\\\/.test(await readFile(path.join(ROOT, p), 'utf8'))) throw Error(kitPath(p) + ' contains a path from one particular computer');
    }
    if ((await lstat(path.join(ROOT, config.native))).size >= 100_000_000) throw Error('the Blender file has reached 100 MB, the size GitHub refuses');
  });

  // Blender stores its screen layout in the file, and the layout remembers folders on the computer that saved it.
  facts.computer_paths_in_model = await computerPathsIn(path.join(ROOT, config.native)).catch(() => []);
  if (facts.computer_paths_in_model.length) warnings.push('The Blender file contains a folder path from this computer (' + facts.computer_paths_in_model[0] + '). That is harmless while editing. Before sharing the file, remove it: see publish/PUBLISHING.md.');

  // Is view/ still what the current model and viewer source would produce?
  // Every input is compared, wherever it lives in the kit: files added, removed or changed since the build.
  const keyed = inputs => Object.fromEntries(Object.entries(inputs).map(([p, h]) => [kitPath(p), h]));
  facts.model_out_of_date = inputChanges(record.model_inputs, keyed(await modelInputs()));
  facts.page_out_of_date = inputChanges(record.viewer_inputs, keyed(await viewerInputs()));
  facts.out_of_date = [...facts.model_out_of_date, ...facts.page_out_of_date];
  if (facts.model_out_of_date.length) warnings.push('view/ is out of date. Since it was built: ' + facts.model_out_of_date.join(', ') + '. Run npm run build.');
  else if (facts.page_out_of_date.length) warnings.push('The page is out of date. Since it was built: ' + facts.page_out_of_date.join(', ') + '. Run npm run build:viewer.');

  // Dependencies are checked on their own: what the lock file asks for, what is installed, what built the page.
  for (const [name, v] of Object.entries(await dependencyVersions())) {
    if (v.installed && v.installed !== v.locked) errors.push('dependencies: ' + name + ' ' + v.installed + ' is installed but the lock file asks for ' + v.locked + '. Run npm ci.');
    if (record.dependencies?.[name] !== v.locked) { warnings.push('The page was built with ' + name + ' ' + record.dependencies?.[name] + '; the lock file asks for ' + v.locked + '. Run npm run build:viewer.'); facts.out_of_date.push('package ' + name); }
  }

  // With the build's working files at hand, the part list can also be checked against what Blender reported.
  facts.working_files = await haveWorkingFiles() && !facts.model_out_of_date.length;
  if (facts.working_files) await rule('working files', async () => {
    const {model, inventory} = await verifyExports();
    const owners = inventory.owners.map(p => p.part_id).sort();
    if (JSON.stringify(model.parts.map(p => p.id).sort()) !== JSON.stringify(owners)) throw Error('the part list and Blender\'s inventory name different parts');
    for (const part of model.parts) {
      const row = inventory.owners.find(r => r.part_id === part.id);
      for (const key of ['group', 'package', 'category', 'service', 'direction', 'distance', 'order', 'fan', 'assembly', 'is_cassette', 'rest_when_separated'])
        if (JSON.stringify(part[key]) !== JSON.stringify(row.presentation[key])) throw Error(part.id + ': "' + key + '" differs between the part list and Blender');
      if (part.name !== row.presentation.display_name || part.status !== row.status) throw Error(part.id + ': name or status differs between the part list and Blender');
    }
  });
  return {errors, warnings, facts};
}
