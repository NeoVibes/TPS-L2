// Confirmation levels, the master parts list and the target reference.
//
// Sources people maintain:  edit/targets.json, edit/assessments.json, edit/service-manual-parts.csv
// Written by the build:     view/master-parts.csv, view/TARGETS.md, view/assessment-results.json
//
// A part's level is the lowest level among its required features. A feature is one measurable thing
// (a diameter, a thickness, a shaft position, a travel). A feature rises above level 1 only through an
// accepted assessment in edit/assessments.json that still holds: the parts it was accepted against have
// not changed, its target is unchanged, and the model passes that target's check.
import {targetDefinition, targetOutcome, summarise, runChecks, targetProblems} from './targets.mjs';
import {json, fileHash, serviceCatalog, SERVICE_PARTS_CSV, TARGETS, ASSESSMENTS} from './integrity.mjs';
import {fingerprint} from './compare.mjs';
import {exteriorStates} from '../viewer/exterior.mjs';

export const LEVELS = [
  'Not modelled',
  'Modelled estimate; its basis has not been independently assessed',
  'Based on reference material: standards, manufacturer specifications, photos or service manuals',
  'Estimated from photographs using a defined measuring reference or system',
  'Measured from a physical part, without additional supporting evidence',
  'Measured from a physical part with supporting evidence',
  'Level 5 corroborated by at least two people using two different physical units',
];
export const PLACEHOLDER = 'overall geometry';      // stands in until a maintainer writes the part's feature checklist
export const VARIANTS = ['original', 'detailed'];   // the two cassettes share part IDs and are assessed separately
// A part whose lettering differs between exterior versions has one row per distinct state, named by the
// versions that show it ("later", "intermediate+early"). Each state is assessed separately too.
const BOUND = ['shape', 'poses', 'spin', 'control'];
const BOUND_WORDS = {shape: 'shape', poses: 'position', spin: 'motion', control: 'control travel'};

export const rowId = (partId, variant) => variant ? partId + '/' + variant : partId;
/** The name a row's fingerprint is stored under (tools/compare.mjs). The state that includes the default exterior version is stored under the part's own ID. */
export const fingerprintKey = (partId, variant, known = {}) => variant === 'detailed' ? 'cassette alternative ' + partId : ('exterior ' + variant + ' ' + partId) in known ? 'exterior ' + variant + ' ' + partId : partId;

/** One row per modelled part (two for each cassette part) and one per service-manual entry that has no model part. */
export function listRows(view, catalog) {
  const {meta, measured, packageTable} = view, rows = [];
  const manual = new Map();
  for (const entry of catalog) for (const id of entry.partIds) manual.set(id, [...(manual.get(id) || []), entry]);
  // A part moves if any mode puts it somewhere else than "stop", if it spins, or if a control drags it.
  const dragged = new Set(Object.values(view.pageMotion?.controls || {}).flatMap(c => Object.keys(c.parts || {})));
  const moves = part => Object.keys(part.spin || {}).length > 0 || dragged.has(part.id) ||
    Object.values(part.poses).some(pose => pose.flat().some((v, i) => Math.abs(v - part.poses.stop.flat()[i]) > 1e-6));
  const detailed = new Set((meta.alternatives?.cassette?.parts || []).map(p => p.id));
  for (const part of [...meta.parts].sort((a, b) => a.id < b.id ? -1 : 1)) {
    const base = {status: 'modelled', part_id: part.id, name: part.name.replace(part.id + ' • ', ''), group: part.group, category: part.category, moves: moves(part) ? 'yes' : 'no'};
    const states = exteriorStates(part, meta.exterior);
    const variants = part.is_cassette ? VARIANTS.filter(v => v === 'original' || detailed.has(part.id)) : states.length ? states.map(s => s.name) : [''];
    for (const variant of variants) {
      const state = states.find(s => s.name === variant);
      const entries = (manual.get(part.id) || []).filter(e => !e.partStates?.[part.id] || e.partStates[part.id].includes(variant)), list = pick => [...new Set(entries.map(pick).filter(Boolean))].join(' ');
      const m = (variant === 'detailed' ? measured.cassette_detailed : state && !state.base ? measured.exterior[state.versions[0]] : measured.parts)[part.id] || {};
      rows.push({...base, manual_part_no: list(e => e.partNumber), manual_ref_no: list(e => e.refNo), manual_catalog_id: list(e => e.id), row_id: rowId(part.id, variant), variant, geometry_file: 'geometry/' + (variant === 'detailed' ? packageTable.cassette.file : packageTable[part.package].file), measured: m});
    }
  }
  const modelled = new Set(meta.parts.map(p => p.id));
  for (const entry of catalog) if (!entry.partIds.some(id => modelled.has(id)))
    rows.push({status: 'not modelled', row_id: 'manual/' + entry.id, part_id: '', variant: '', name: entry.description, group: '', category: entry.category, geometry_file: '',
      manual_part_no: entry.partNumber || '', manual_ref_no: entry.refNo || '', manual_catalog_id: entry.id, moves: '', measured: {}});
  return rows;
}

/** What is wrong with edit/assessments.json, as sentences. Empty when it is sound. */
export function assessmentProblems(file, rows, targetFile) {
  const problems = [], rowIds = new Map(rows.filter(r => r.status === 'modelled').map(r => [r.row_id, r])), targets = new Set(targetFile.targets.map(t => t.id)), ids = new Set();
  // A cassette part, or a part whose lettering differs between exterior versions, has several rows; say which exist.
  const several = part => { const variants = rows.filter(r => r.part_id === part.split('/')[0] && r.variant).map(r => r.variant); return variants.length ? '; this part needs "variant": ' + variants.map(v => '"' + v + '"').join(' or ') : ''; };
  for (const [row, list] of Object.entries(file.checklists || {})) {
    if (!rowIds.has(row)) problems.push('checklist ' + row + ': there is no such row' + several(row));
    if (!Array.isArray(list.features) || !list.features.length || new Set(list.features).size !== list.features.length || list.features.some(f => typeof f !== 'string' || !f.trim()))
      problems.push('checklist ' + row + ': "features" must be a list of different feature names');
    if (list.features?.includes(PLACEHOLDER)) problems.push('checklist ' + row + ': "' + PLACEHOLDER + '" is the placeholder; name the real features instead');
    if (!list.reviewed) problems.push('checklist ' + row + ': say who reviewed it in "reviewed" (an issue number or "maintainer")');
  }
  for (const a of file.assessments || []) {
    const where = 'assessment ' + (a.id || '(no id)');
    if (!a.id || ids.has(a.id)) problems.push(where + ': every assessment needs its own id');
    ids.add(a.id);
    if (!rowIds.has(rowId(a.part, a.variant || ''))) problems.push(where + ': ' + rowId(a.part, a.variant || '') + ' is not a row of the master list' + several(a.part));
    if (typeof a.feature !== 'string' || !a.feature.trim() || a.feature === PLACEHOLDER) problems.push(where + ': name the feature that was assessed');
    if (!Number.isInteger(a.level) || a.level < 2 || a.level > 5) problems.push(where + ': "level" must be 2, 3, 4 or 5 (level 6 comes from a corroboration)');
    if (a.level >= 3 && !a.target) problems.push(where + ': levels 3 to 5 rest on a measurement, so they need a "target"');
    if (a.target && !targets.has(a.target)) problems.push(where + ': target ' + a.target + ' is not in edit/targets.json');
    if (!Array.isArray(a.issues) || !a.issues.length || a.issues.some(n => !Number.isInteger(n) || n < 1)) problems.push(where + ': "issues" must list the issue numbers it came from');
    const extra = Object.keys(a).filter(k => !['id', 'part', 'variant', 'feature', 'level', 'target', 'issues', 'note', 'bound_to'].includes(k));
    if (extra.length) problems.push(where + ': unknown field ' + extra.join(', ') + ' (names and serial numbers are never stored here)');
  }
  for (const [i, c] of (file.corroborations || []).entries()) {
    const where = 'corroboration ' + (i + 1), found = (c.assessments || []).map(id => (file.assessments || []).find(a => a.id === id));
    if (!Array.isArray(c.assessments) || c.assessments.length < 2 || found.some(a => !a)) { problems.push(where + ': must name at least two assessments that exist'); continue; }
    if (new Set(found.map(a => [a.part, a.variant || '', a.feature].join('|'))).size !== 1) problems.push(where + ': its assessments must be about the same feature of the same part and variant');
  }
  return problems;
}

/**
 * Ties the table of exterior versions in edit/targets.json to the model. For every part, versions that the
 * table describes with the same words must show the same lettering in the model, and versions it describes
 * differently must show different lettering. Returns sentences; empty when table and model agree.
 */
export function versionProblems(targetFile, meta) {
  const versions = meta.exterior?.versions || [], areas = targetFile.versions?.areas || [], problems = [];
  const grouping = groups => groups.map(g => [...g].sort().join('+')).sort().join(' | ');
  for (const part of meta.parts) {
    const mine = areas.filter(a => a.part === part.id), states = exteriorStates(part, meta.exterior);
    if (!mine.length && !states.length) continue;
    if (!mine.length) { problems.push('versions table: ' + part.id + ' shows different lettering in different exterior versions but is not in the table'); continue; }
    for (const a of mine) for (const v of versions) if (!a[v]) problems.push('versions table: "' + a.area + '" says nothing for the ' + v + ' version');
    const described = new Map();
    for (const v of versions) { const words = mine.map(a => a[v]).join(' / '); described.set(words, [...(described.get(words) || []), v]); }
    const table = grouping([...described.values()]), model = grouping(states.length ? states.map(s => s.versions) : [versions]);
    if (table !== model) problems.push('versions table: for ' + part.id + ' the table tells the versions apart as ' + table + ', but the model shows ' + model);
  }
  for (const a of areas) if (!meta.parts.some(p => p.id === a.part)) problems.push('versions table: ' + a.part + ' is not a part of the model');
  return problems;
}

/** A service-manual entry that names a state of a part ("EXT-030/later") must name one that exists. */
export function catalogStateProblems(catalog, rows) {
  const known = new Set(rows.map(r => r.row_id));
  return catalog.flatMap(e => Object.entries(e.partStates || {}).flatMap(([id, states]) => states.filter(s => !known.has(id + '/' + s)).map(s => 'service-manual-parts.csv: ' + e.id + ' names ' + id + '/' + s + ', which is not a row of the master list')));
}

/** What an assessment is tied to at the moment it is accepted: the parts' fingerprints and the target's definition. */
export function bindingFor(assessment, {targetFile, checks, fingerprints}) {
  const variant = assessment.variant || '', own = fingerprintKey(assessment.part, variant, fingerprints.parts), keys = new Set([own]), bound = {parts: {}};
  if (assessment.target) {
    const target = targetFile.targets.find(t => t.id === assessment.target);
    bound.target = targetDefinition(target);
    // Other parts the target and its checks involve: a relation between parts must be reviewed when either moves.
    for (const id of [...(target.parts || []), ...targetOutcome(checks, target.id, variant).checks.flatMap(c => c.parts)]) keys.add(id === assessment.part ? own : id);
  }
  for (const key of [...keys].sort()) {
    const now = fingerprints.parts[key];
    if (!now) throw Error('assessment ' + assessment.id + ': ' + key + ' is not in the built model');
    bound.parts[key] = Object.fromEntries(BOUND.filter(k => k in now).map(k => [k, now[k]]));
  }
  return bound;
}

const allowed = target => 'range' in target ? {lo: target.range[0], hi: target.range[1]} : Array.isArray(target.value) ? {point: target.value, tol: target.tol ?? 0}
  : typeof target.value === 'number' ? {lo: target.value - (target.tol ?? (target.tol_pct ? target.value * target.tol_pct / 100 : 0)), hi: target.value + (target.tol ?? (target.tol_pct ? target.value * target.tol_pct / 100 : 0))} : {exact: target.value};
/** True when two measurements of one feature cannot both be right: their accepted bounds do not meet. */
export function conflicting(a, b) {
  const x = allowed(a), y = allowed(b);
  if ((a.unit || '') !== (b.unit || '')) return true;
  if ('point' in x && 'point' in y) return Math.hypot(...x.point.map((v, i) => v - y.point[i])) > x.tol + y.tol + 1e-9;
  if ('lo' in x && 'lo' in y) return x.lo > y.hi + 1e-9 || y.lo > x.hi + 1e-9;
  if ('exact' in x && 'exact' in y) return x.exact !== y.exact;
  return true;
}

/** Works out every row's level. Returns a Map of row_id → {level, checklist, features, required, confirmed}. */
export function assess({rows, file, targetFile, checks, fingerprints}) {
  const targets = new Map(targetFile.targets.map(t => [t.id, t])), result = new Map();
  const judged = new Map();   // assessment id → {counts, why}
  for (const a of file.assessments || []) {
    const variant = a.variant || '', why = [];
    if (!a.bound_to) why.push('not yet accepted against the model: run npm run accept');
    else {
      for (const [key, was] of Object.entries(a.bound_to.parts || {})) {
        const now = fingerprints.parts[key];
        if (!now) { why.push(key + ' is no longer in the model'); continue; }
        const changed = BOUND.filter(k => (was[k] ?? null) !== (now[k] ?? null)).map(k => BOUND_WORDS[k]);
        if (changed.length) why.push(key + ' changed ' + changed.join(' and ') + ' since this was accepted; it needs assessing again');
      }
      if (a.target && targets.has(a.target) && a.bound_to.target !== targetDefinition(targets.get(a.target))) why.push('target ' + a.target + ' was redefined since this was accepted; it needs assessing again');
    }
    if (a.level >= 3 && !a.target) why.push('levels 3 to 5 need a target');
    if (a.target) {
      if (!targets.has(a.target)) why.push('target ' + a.target + ' is not in edit/targets.json');
      else {
        const outcome = targetOutcome(checks, a.target, variant);
        if (outcome.status === 'no check') why.push('target ' + a.target + ' has no check' + (variant ? ' for the ' + variant + ' cassette' : '') + ' yet, so the model cannot be compared with it');
        else if (outcome.status === 'no data') why.push('the check for ' + a.target + ' could not be made on this model');
        else if (outcome.status === 'fail') for (const c of outcome.checks.filter(c => c.status === 'fail'))
          why.push('the model does not match ' + a.target + ': ' + c.id + ' gives ' + c.value + (c.unit ? ' ' + c.unit : '') + (c.allowed ? ', allowed ' + c.allowed.map(v => v ?? '…').join(' to ') : ''));
      }
    }
    judged.set(a.id, {counts: !why.length, why});
  }
  // Measurements of the same feature whose bounds do not meet stay separate, and neither counts until one is withdrawn.
  const accepted = (file.assessments || []).filter(a => a.bound_to && a.target && targets.has(a.target));
  for (const a of accepted) for (const b of accepted) {
    if (a === b || a.part !== b.part || (a.variant || '') !== (b.variant || '') || a.feature !== b.feature || a.target === b.target) continue;
    if (conflicting(targets.get(a.target), targets.get(b.target))) { const j = judged.get(a.id); j.counts = false; j.why.push('conflicts with ' + b.id + ' (' + b.target + '); neither counts until this is resolved'); }
  }

  for (const row of rows) {
    if (row.status !== 'modelled') { result.set(row.row_id, {level: 0, checklist: '', features: [], required: 0, confirmed: 0}); continue; }
    const list = file.checklists?.[row.row_id], required = list?.features?.length ? list.features : [PLACEHOLDER];
    const mine = (file.assessments || []).filter(a => a.part === row.part_id && (a.variant || '') === row.variant);
    const names = [...required, ...new Set(mine.map(a => a.feature).filter(f => !required.includes(f)))];
    const features = names.map(name => {
      const about = mine.filter(a => a.feature === name), counting = about.filter(a => judged.get(a.id).counts);
      let level = counting.length ? Math.max(...counting.map(a => a.level)) : 1;
      const why = [];
      if (name === PLACEHOLDER) why.push('not assessed: this part has no reviewed feature checklist yet');
      else if (!about.length) why.push('not assessed');
      for (const a of about) if (!judged.get(a.id).counts) why.push(a.id + ' does not count: ' + judged.get(a.id).why.join('; '));
      // Level 6: two or more level-5 assessments that all count, from different submissions, with distinct people and units verified.
      for (const c of file.corroborations || []) {
        const set = (c.assessments || []).map(id => about.find(a => a.id === id));
        if (set.length < 2 || set.some(a => !a)) continue;
        const issues = set.flatMap(a => a.issues || []);
        if (set.some(a => !judged.get(a.id).counts || a.level !== 5)) why.push('corroboration of ' + c.assessments.join(' and ') + ' does not count: each must be a level 5 assessment that holds');
        else if (new Set(issues).size !== issues.length) why.push('corroboration of ' + c.assessments.join(' and ') + ' does not count: the assessments come from the same submission');
        else if (c.distinct_people_and_units_verified !== true) why.push('corroboration of ' + c.assessments.join(' and ') + ' does not count: a maintainer has not verified that two different people measured two different units');
        else level = 6;
      }
      return {name, required: required.includes(name), level, why, assessments: about.map(a => ({id: a.id, level: a.level, target: a.target || null, issues: a.issues, counts: judged.get(a.id).counts}))};
    });
    const needed = features.filter(f => f.required);
    result.set(row.row_id, {level: Math.min(...needed.map(f => f.level)), checklist: list ? 'reviewed' : 'placeholder', features, required: needed.length, confirmed: needed.filter(f => f.level > 1).length});
  }
  return result;
}

const csvField = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s; };

export const MASTER_COLUMNS = ['row_id', 'status', 'part_id', 'variant', 'name', 'group', 'category', 'geometry_file', 'manual_part_no', 'manual_ref_no', 'manual_catalog_id',
  'confirmation_level', 'features_confirmed', 'feature_levels', 'level_notes', 'targets',
  'model_width_mm', 'model_depth_mm', 'model_height_mm', 'model_longest_length_mm', 'model_volume_mm3', 'closed_solid', 'why_not_closed', 'blender_objects', 'vertices', 'faces', 'moves'];

/** view/master-parts.csv: every modelled part and every service-manual entry without one. The model_ columns are the model's own sizes, not measurements of a real unit. */
export function masterCsv(rows, levels, targetFile, checks) {
  const lines = rows.map(row => {
    const l = levels.get(row.row_id), m = row.measured, modelled = row.status === 'modelled';
    const about = modelled ? targetFile.targets.filter(t => (t.parts || []).includes(row.part_id) || t.measure?.size_of === row.part_id).map(t => t.id + ' (' + targetOutcome(checks, t.id, row.variant).status + ')') : [];
    return [row.row_id, row.status, row.part_id, row.variant, row.name, row.group, row.category, row.geometry_file, row.manual_part_no, row.manual_ref_no, row.manual_catalog_id,
      l.level, modelled ? l.confirmed + ' of ' + l.required : '', l.features.map(f => f.name + ': ' + f.level + (f.level === 1 && !f.assessments.length ? ' (not assessed)' : '') + (f.required ? '' : ' (not required)')).join('; '),
      l.features.flatMap(f => f.why.filter(w => !w.startsWith('not assessed')).map(w => f.name + ': ' + w)).join('; '), about.join('; '),
      m.size_mm?.[0], m.size_mm?.[1], m.size_mm?.[2], m.longest_length_mm, m.volume_mm3, modelled ? (m.closed_solid ? 'yes' : 'no') : '', m.why_not_closed, m.blender_objects ?? m.solids, m.vertices, m.faces, row.moves];
  });
  return [MASTER_COLUMNS, ...lines].map(r => r.map(csvField).join(',')).join('\n') + '\n';
}

const cell = v => String(v ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const shown = t => 'range' in t ? t.range[0] + ' to ' + t.range[1] : Array.isArray(t.value) ? '(' + t.value.join(', ') + ')' : String(t.value);
const tolerance = t => 'range' in t ? '' : t.tol !== undefined && t.tol !== null ? '± ' + t.tol : t.tol_pct ? '± ' + t.tol_pct + ' %' : 'not stated';

/** view/TARGETS.md: every target and how the model compares, for reading. */
export function targetsMarkdown(targetFile, checks, version, exteriors) {
  const summary = summarise(checks), counts = {pass: 0, fail: 0, 'no data': 0, 'no check': 0};
  const table = targetFile.targets.map(t => {
    const outcome = targetOutcome(checks, t.id); counts[outcome.status]++;
    const model = outcome.checks.map(c => c.value + (c.id.includes('axis') && c.expected === 0 ? ' off' : '')).join(', ');
    const notes = [t.frame, t.modes ? 'in ' + t.modes.join(', ') : '', (t.parts || []).join(' ')].filter(Boolean).join('; ');
    return '| `' + t.id + '` | ' + cell(shown(t)) + ' | ' + cell(tolerance(t)) + ' | ' + cell(t.unit || '') + ' | ' + t.class + ' | ' + cell(t.basis) + ' | ' + cell(notes) + ' | ' + cell(model) + ' | ' + (outcome.status === 'pass' ? 'pass' : outcome.status === 'fail' ? '**fail**' : outcome.status) + ' |';
  });
  const other = checks.filter(c => !c.target).map(c => '| `' + c.id + '` | ' + c.group + ' | ' + cell(c.value) + ' ' + cell(c.unit) + ' | ' + cell(c.allowed ? c.allowed.map(v => v ?? '…').join(' to ') : c.status === 'info' ? '' : 'must be true') + ' | ' + (c.status === 'fail' ? '**fail**' : c.status) + ' | ' + cell(c.note) + ' |');
  const v = targetFile.versions, order = [...exteriors].reverse();   // oldest first, as people tell the story
  return `# Targets

Version ${version}. Written by the build from \`edit/targets.json\`; edit that file, not this one.

**These are the numbers the model is meant to match, and how the model compares today.** Most come from photographs, videos, Sony's service manual and published standards. A target is not a measurement of a real unit unless its class is \`measured\`. Where the model fails a target, the model is wrong or the target is in doubt; both are shown rather than hidden.

Of ${targetFile.targets.length} targets, the model passes ${counts.pass}, fails ${counts.fail} and has no check yet for ${counts['no check']}${counts['no data'] ? '; ' + counts['no data'] + ' could not be checked on this model' : ''}.

## The three exterior versions

The model can be shown as any of three exterior versions. Only lettering differs between them.

| | ${order.map(e => e.label).join(' | ')} |
|---|${order.map(() => '---').join('|')}|
| Serial number, approximate | ${order.map(e => cell(e.serials)).join(' | ')} |
${v.areas.map(a => '| ' + cell(a.area) + ' (`' + a.part + '`) | ' + order.map(e => cell(a[e.id])).join(' | ') + ' |').join('\n')}

${v.source}

${v.shared}

Limitations:
${v.limitations.map(s => '- ' + s).join('\n')}

Sony's manual also distinguishes these, which the model does not follow:
${v.other_documented.map(s => '- ' + s).join('\n')}

## Classes

| Class | What it means |
|---|---|
${Object.entries(targetFile.classes).map(([k, text]) => '| ' + k + ' | ' + cell(text) + ' |').join('\n')}

Tolerance is the uncertainty on the target, not a manufacturing tolerance. Lengths are in mm. Height is the long dimension of the body, width is across the front, depth is front to back.

## Targets

"Model" is what the check measures on the model. For a shaft position it is the distance from the target position.

| Target | Value | Tolerance | Unit | Class | Rests on | Applies to | Model | Outcome |
|---|---|---|---|---|---|---|---|---|
${table.join('\n')}

## Other checks

Checks that have no target of their own: they test that the model is consistent with itself or with several targets at once.

| Check | Group | Model | Allowed | Outcome | Note |
|---|---|---|---|---|---|
${other.join('\n')}

Totals by group: ${Object.entries(summary).map(([g, s]) => g + ' ' + s.pass + ' pass, ' + s.fail + ' fail' + (s.info ? ', ' + s.info + ' for information' : '') + (s['no data'] ? ', ' + s['no data'] + ' not checked' : '')).join('; ')}.
`;
}

/** view/assessment-results.json: the checks, each target's outcome and each row's level, tied to the inputs they were worked out from. */
export function resultsRecord({rows, levels, targetFile, checks, boundTo, version}) {
  const count = {};
  for (const row of rows) count[levels.get(row.row_id).level] = (count[levels.get(row.row_id).level] || 0) + 1;
  return {
    what: 'Results of checking the model against edit/targets.json and edit/assessments.json. Written by "npm run build"; do not edit. Issue numbers refer to this project\'s GitHub issues.',
    version, bound_to: boundTo, levels: LEVELS, rows_at_each_level: count, check_totals: summarise(checks),
    targets: Object.fromEntries(targetFile.targets.map(t => { const o = targetOutcome(checks, t.id); return [t.id, {definition: targetDefinition(t), outcome: o.status, checks: o.checks.map(c => c.id)}]; })),
    checks,
    rows: Object.fromEntries(rows.filter(r => r.status === 'modelled').map(r => { const l = levels.get(r.row_id); return [r.row_id, {level: l.level, checklist: l.checklist, features: l.features}]; })),
    not_modelled: rows.filter(r => r.status !== 'modelled').map(r => r.row_id),
  };
}

/** Everything worked out from a built view and the lists in edit/: rows, checks, levels, and the three files that go beside the page. */
export async function confirmation(view, version) {
  if (!view.measured) throw Error('This build carries no measurements of the model. Run npm run build (needs Blender).');
  const [targetFile, file, catalog, release] = await Promise.all([json(TARGETS), json(ASSESSMENTS), serviceCatalog(), json('config/release.json')]);
  const rows = listRows(view, catalog);
  const problems = [...targetProblems(targetFile, view.meta.parts.map(p => p.id)), ...versionProblems(targetFile, view.meta), ...catalogStateProblems(catalog, rows), ...assessmentProblems(file, rows, targetFile)];
  if (problems.length) throw Error('The lists in edit/ need fixing: ' + problems.join('; ') + '.');
  const checks = runChecks(targetFile, view.measured), fingerprints = fingerprint(view);
  const levels = assess({rows, file, targetFile, checks, fingerprints});
  // What these results were worked out from. A result whose inputs have since changed is out of date and must not be shipped.
  const boundTo = {model: view.meta.source_sha256, targets: await fileHash(TARGETS), assessments: await fileHash(ASSESSMENTS), service_list: await fileHash(SERVICE_PARTS_CSV)};
  const files = {'master-parts.csv': masterCsv(rows, levels, targetFile, checks), 'TARGETS.md': targetsMarkdown(targetFile, checks, version, release.exteriors || []),
    'assessment-results.json': JSON.stringify(resultsRecord({rows, levels, targetFile, checks, boundTo, version}), null, 1) + '\n'};
  return {targetFile, file, rows, checks, fingerprints, levels, boundTo, files};
}
