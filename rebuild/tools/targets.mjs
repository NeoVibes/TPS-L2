// Checks the model against the targets in edit/targets.json.
//
// The measurements come from the build (tools/measure_parts.py and tools/measure_targets.py) and travel
// in view/geometry/model.js, so the checks can be run again without Blender after a target is edited.
//
// Each check says which target it tests ("target") and which other targets it only reads ("uses").
// A target with no check of its own cannot support a confirmation level; add a tested check here first.
// A check gives pass, fail, info (nothing to compare with) or "no data" (the measurement is missing,
// for example because the part was removed).
import {createHash} from 'node:crypto';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round4 = v => typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v;
const xz = p => [p[0], p[2]];
const SIZE_AXES = {width: 0, depth: 1, height: 2};

/** The fields that define a target. A change to any of them means an assessment bound to the target must be reviewed again. */
const DEFINITION = ['value', 'tol', 'tol_pct', 'range', 'unit', 'frame', 'modes', 'moving', 'through_axis', 'class', 'parts', 'variant', 'measure'];
export const targetDefinition = target => createHash('sha256').update(JSON.stringify(DEFINITION.map(k => target[k] ?? null))).digest('hex').slice(0, 16);

/** What is wrong with the targets file, as a list of sentences. Empty when it is sound. */
export function targetProblems(file, partIds = null) {
  const problems = [], seen = new Set();
  for (const t of file.targets || []) {
    const where = 'target ' + (t.id || '(no id)');
    if (!t.id || seen.has(t.id)) problems.push(where + ': every target needs its own id');
    seen.add(t.id);
    if (!(t.class in (file.classes || {}))) problems.push(where + ': unknown class "' + t.class + '"');
    if (!('value' in t) && !('range' in t)) problems.push(where + ': needs a value or a range');
    if (!t.basis) problems.push(where + ': needs a basis line');
    if (/\/Users\/|[A-Z]:\\/.test(JSON.stringify(t))) problems.push(where + ': contains a path from one particular computer');
    if ('variant' in t && !['original', 'detailed'].includes(t.variant)) problems.push(where + ': "variant" is only for cassette parts and must be original or detailed');
    if (t.measure) {
      if (!(t.measure.along in SIZE_AXES) && t.measure.along !== 'longest') problems.push(where + ': measure.along must be width, depth, height or longest');
      if (!t.measure.size_of) problems.push(where + ': measure.size_of must name a part');
      if (t.unit !== 'mm' || !('tol' in t || 'range' in t)) problems.push(where + ': a measured size needs unit mm and a tolerance or a range');
      if (partIds && t.measure.size_of && !partIds.includes(t.measure.size_of)) problems.push(where + ': ' + t.measure.size_of + ' is not a part of the model');
    }
  }
  return problems;
}

/** Runs every check. Returns one record per check, in a fixed order. */
export function runChecks(file, measured) {
  const byId = new Map(file.targets.map(t => [t.id, t])), g = measured.targets, checks = [];
  const T = id => { const t = byId.get(id); if (!t) throw Error('target ' + id + ' is not in edit/targets.json'); return t; };

  // compute() returns {value, target?, tol?, lo?, hi?, ok?, note?, parts?}. Anything it cannot work out becomes "no data".
  function add(group, id, about, compute) {
    const primary = about.target ? byId.get(about.target) : null;
    const record = {group, id, target: about.target || null, uses: about.uses || [], variant: about.variant || null, value: null, expected: null, allowed: null,
      unit: about.unit ?? primary?.unit ?? '', class: about.cls ?? primary?.class ?? '', parts: about.parts ?? primary?.parts ?? [], status: 'no data', note: about.note || ''};
    try {
      if (about.target && !primary) throw Error('target ' + about.target + ' is not in edit/targets.json');
      const r = compute();
      if (r.value === undefined || r.value === null || typeof r.value === 'number' && !Number.isFinite(r.value)) throw Error('the measurement is missing');
      let lo = r.lo ?? null, hi = r.hi ?? null, ok = r.ok ?? null;
      if (ok === null) {
        if (r.target !== undefined && r.target !== null && r.tol !== undefined && r.tol !== null) { lo = r.target - r.tol; hi = r.target + r.tol; }
        ok = lo === null && hi === null ? null : (lo === null || r.value >= lo - 1e-9) && (hi === null || r.value <= hi + 1e-9);
      }
      Object.assign(record, {value: round4(r.value), expected: r.target ?? null, allowed: lo === null && hi === null ? null : [round4(lo), round4(hi)], status: ok === null ? 'info' : ok ? 'pass' : 'fail'});
      if (r.note) record.note = r.note;
      if (r.parts) record.parts = r.parts;
    } catch (error) { record.note = (record.note ? record.note + ' ' : '') + 'Not checked: ' + (error instanceof TypeError ? 'the measurement is missing' : error.message) + '.'; }
    checks.push(record);
  }
  // A check that compares one measured number with one target's value and tolerance.
  const direct = (group, id, targetId, value, about = {}) => add(group, id, {...about, target: targetId}, () => {
    const p = T(targetId);
    return {value: value(), target: p.value, tol: about.tol ?? ('tol' in p ? p.tol : 'tol_pct' in p ? p.value * p.tol_pct / 100 : 0)};
  });

  // ---------- solids
  add('solids', 'solids.single_closed_shell', {unit: 'parts', cls: 'designed'}, () => {
    const all = Object.entries(measured.parts), bad = all.filter(([, p]) => !p.closed_solid).map(([id]) => id).sort();
    return {value: bad.length, target: 0, tol: 0, parts: bad, note: all.length + ' parts: ' + (all.length - bad.length) + ' are one closed solid, ' + bad.length + ' are not. Vertices closer than 0.001 mm are joined; lettering is left out.'};
  });

  // ---------- envelope
  const ex = g.exterior, P = ex?.parts, pane = () => P['EXT-031'], front = () => ex.front_face_x, blueRight = () => P['EXT-030'][1][0];
  direct('envelope', 'body.height', 'body.height', () => ex.union[1][2] - ex.union[0][2]);
  direct('envelope', 'body.front_width', 'body.front_width', () => front()[1] - front()[0], {note: 'Across vertices within 1 mm of the front plane; side keys and trim excluded.'});
  direct('envelope', 'body.depth', 'body.depth', () => Math.max(...['EXT-010', 'EXT-020', 'EXT-040'].map(p => P[p][1][1])) - Math.min(...['EXT-020', 'EXT-030'].map(p => P[p][0][1])), {parts: ['EXT-010', 'EXT-020', 'EXT-030', 'EXT-040']});
  direct('envelope', 'front.silver_strip', 'front.silver_strip', () => front()[1] - blueRight(), {parts: ['GRL-001']});
  direct('envelope', 'front.top_band', 'front.top_band', () => P['EXT-020'][1][2] - P['EXT-020'][0][2]);
  direct('envelope', 'window.opening_width', 'window.opening_width', () => pane()[1][0] - pane()[0][0], {note: 'Model has a flat pane and a printed surround, no bevelled opening; the pane is compared.'});
  direct('envelope', 'window.opening_height', 'window.opening_height', () => pane()[1][2] - pane()[0][2]);
  direct('envelope', 'window.right_edge_to_strip', 'window.right_edge_to_strip', () => blueRight() - pane()[1][0], {parts: ['EXT-031']});
  direct('envelope', 'window.bottom_to_body_bottom', 'window.bottom_to_body_bottom', () => pane()[0][2] - ex.union[0][2], {parts: ['EXT-031']});
  direct('envelope', 'window.left_margin', 'window.left_margin', () => pane()[0][0] - P['EXT-030'][0][0], {parts: ['EXT-031', 'EXT-030']});
  // The cassette measured here is the one in the Blender file (the "original" variant).
  const cassette = () => { const shells = [ex['MEDIA-001'], ex['MEDIA-002']]; return {lo: [0, 1, 2].map(i => Math.min(...shells.map(c => c[0][i]))), hi: [0, 1, 2].map(i => Math.max(...shells.map(c => c[1][i])))}; };
  direct('envelope', 'cassette.thickness_head_end', 'cassette.thickness_head_end', () => cassette().hi[1] - cassette().lo[1], {variant: 'original', note: 'Overall thickness of the cassette shells in the model.'});
  direct('envelope', 'cassette.width', 'cassette.width', () => cassette().hi[2] - cassette().lo[2], {variant: 'original', parts: ['MEDIA-001', 'MEDIA-002']});
  direct('envelope', 'cassette.height', 'cassette.height', () => cassette().hi[0] - cassette().lo[0], {variant: 'original', parts: ['MEDIA-001', 'MEDIA-002']});
  add('envelope', 'cassette.left_wall_room_at_registered_width', {uses: ['body.front_width'], variant: 'original', unit: 'mm', cls: 'designed', parts: ['MEDIA-001', 'EXT-030'],
    note: 'Room left of the cassette if the width surplus is removed from the left side. Needs a wall plus clearance; 2 mm is a working minimum.'},
    () => ({value: (cassette().lo[0] - P['EXT-030'][0][0]) - ((front()[1] - front()[0]) - T('body.front_width').value), lo: 2.0}));

  // ---------- axes: shafts that pass through the chassis must line up on both sides and with the cassette standard
  const pv = g.pivots, rp = g.round_parts;
  const cap = () => xz(pv.capstan_flywheel), tu = () => xz(pv.takeup_reel), su = () => xz(pv.supply_reel);
  direct('axes', 'reel_pitch', 'cassette.reel_pitch', () => dist(tu(), su()), {parts: ['DRV-010', 'DRV-014']});
  direct('axes', 'capstan_row_to_reel_row', 'cassette.capstan_row_to_reel_row', () => cap()[0] - tu()[0], {parts: ['BAY-052', 'MEC-011']});
  direct('axes', 'capstan_outboard_of_takeup_reel', 'cassette.capstan_outboard_of_reel', () => Math.sign(tu()[1] - su()[1] || 1) * (cap()[1] - tu()[1]), {parts: ['BAY-052', 'MEC-011']});
  for (const [id, part, pivot] of [['flywheel_on_capstan_axis', 'MEC-011', cap], ['capstan_shaft_on_axis', 'BAY-052', cap], ['s_gear_a_on_supply_axis', 'DRV-010', su],
    ['takeup_gear_on_takeup_axis', 'DRV-014', tu], ['supply_hub_on_supply_axis', 'MEDIA-003', su], ['takeup_hub_on_takeup_axis', 'MEDIA-005', tu]])
    add('axes', id, {unit: 'mm', cls: 'designed', parts: [part], variant: part.startsWith('MEDIA-') ? 'original' : null, note: 'Centre of the part against the axis it turns on; both faces of the chassis must share it.'},
      () => ({value: dist(rp[part].centre_xz, pivot()), target: 0.0, tol: 0.05}));
  for (const [id, a, b] of [['cassette_hub_pivots_match_reel_pivots', 'supply_hub', 'supply_reel'], ['cassette_hub_pivots_match_reel_pivots_takeup', 'takeup_hub', 'takeup_reel']])
    add('axes', id, {unit: 'mm', cls: 'designed'}, () => ({value: dist(xz(pv[a]), xz(pv[b])), target: 0.0, tol: 0.05}));
  // u runs toward the supply reel, v toward the capstan row, from the take-up axis.
  const uv = p => [tu()[1] > su()[1] ? tu()[1] - p[1] : p[1] - tu()[1], p[0] - tu()[0]];
  const place = m => '(' + m[0].toFixed(2) + ', ' + m[1].toFixed(2) + ')';
  for (const [id, targetId, pivot] of [['reverse_wheel_axis', 'axis.reverse_wheel', 'reverse_wheel'], ['fr_gear_b_axis', 'axis.fr_gear_b', 'fr_gear_b']])
    add('axes', id, {target: targetId, unit: 'mm'}, () => { const p = T(targetId), m = uv(xz(pv[pivot])); return {value: dist(m, p.value), target: 0.0, tol: p.tol, note: 'Model at u,v = ' + place(m) + '; target ' + JSON.stringify(p.value) + '.'}; });
  const centre = (mode, part) => g.modes[mode].parts[part].centre_xz;
  for (const [id, targetId, part, mode] of [['fr_pulley_axis_ff', 'axis.fr_pulley_engaged', 'DRV-023', 'ff'], ['fr_pulley_axis_rew', 'axis.fr_pulley_engaged', 'DRV-023', 'rew'],
    ['fr_pulley_axis_play', 'axis.fr_pulley_released', 'DRV-023', 'play'], ['fr_gear_a_axis_ff', 'axis.fr_gear_a_ff', 'DRV-012', 'ff'], ['fr_gear_a_axis_rew', 'axis.fr_gear_a_rew', 'DRV-012', 'rew'],
    ['fr_gear_a_axis_play', 'axis.fr_gear_a_play', 'DRV-012', 'play'], ['fwd_pulley_axis_play', 'axis.fwd_pulley_engaged', 'FWD-021', 'play']])
    add('axes', id, {target: targetId, unit: 'mm'}, () => { const p = T(targetId), m = uv(centre(mode, part)); return {value: dist(m, p.value), target: 0.0, tol: p.tol, note: mode.toUpperCase() + ': model at u,v = ' + place(m) + '; target ' + JSON.stringify(p.value) + '.'}; });
  add('axes', 'fr_gear_a_arm_about_fr_gear_b', {target: 'arm.fr_gear_a_about_fr_gear_b', unit: 'mm'}, () => { const p = T('arm.fr_gear_a_about_fr_gear_b'); return {value: dist(xz(pv.fr_gear_a), xz(pv.fr_gear_b)), target: p.value, tol: p.tol}; });

  // ---------- motion: rates are rad/s as the Blender motion rig defines them
  const rates = g.rates_rad_s, fly = () => rates.flywheel, run = name => g.run[name];
  const capD = () => rp['BAY-052'].diameter_x, flyR = () => rp['MEC-011'].diameter_x / 2;
  direct('motion', 'capstan.diameter', 'capstan.diameter', capD);
  direct('motion', 'flywheel.rim_diameter', 'flywheel.rim_diameter', () => rp['MEC-011'].diameter_x);
  direct('motion', 'reverse_wheel.outer_diameter', 'reverse_wheel.outer_diameter', () => rp['DRV-022'].diameter_x);
  direct('motion', 'tape.speed', 'tape.speed', () => Math.abs(fly().play) * capD() / 2, {parts: ['BAY-052', 'MEC-011'], note: 'Flywheel rate in PLAY times the capstan radius, as modelled.'});
  direct('motion', 'flywheel.rate_play', 'flywheel.rate_play', () => Math.abs(fly().play) / (2 * Math.PI));
  add('motion', 'motor.never_reverses', {target: 'motor.never_reverses', parts: ['MTR-005', 'MEC-011']}, () => {
    const all = [fly().play, fly().ff, fly().rew], same = Math.min(...all) * Math.max(...all) > 0;
    return {value: same, ok: same, note: 'Flywheel rate (rad/s) PLAY ' + all[0].toFixed(2) + ', FF ' + all[1].toFixed(2) + ', REW ' + all[2].toFixed(2) + '; the motor ratio is fixed, so a sign change is a reversed motor.'};
  });
  for (const [id, reel] of [['reel.takeup_rate_matches_tape', 'takeup'], ['reel.supply_rate_matches_tape', 'supply']])
    add('motion', id, {uses: ['tape.speed'], unit: 'rad/s', cls: 'standard', parts: ['DRV-014', 'DRV-010'], note: 'A reel must turn at tape speed over its pack radius, between an empty hub (about 11 mm) and a full C-90 pack (about 25.5 mm).'},
      () => ({value: Math.abs(rates[reel].play), lo: T('tape.speed').value / 25.5, hi: T('tape.speed').value / 11.0}));
  add('motion', 'reel.rates_are_independent', {cls: 'designed', parts: ['DRV-010', 'DRV-014'], note: 'Supply and take-up share one fixed rate in every mode: no slip clutch and no tape conservation between the packs.'},
    () => { const differ = rates.supply.play !== rates.takeup.play; return {value: differ, ok: differ}; });
  direct('motion', 'ratio.reverse_wheel_to_flywheel', 'ratio.reverse_wheel_to_flywheel', () => Math.abs(run('belt return guide').factor));
  for (const [id, name, gear, parts] of [['gear.s_gear_b_ratio', 'supply intermediate', 'gear.s_gear_b.teeth', ['DRV-011', 'DRV-010']], ['gear.fr_gear_b_ratio', 'FR gear B', 'gear.fr_gear_b.teeth', ['DRV-013']]])
    add('motion', id, {uses: ['gear.s_gear_a.teeth', gear], cls: 'photo-measured', parts}, () => {
      const a = T('gear.s_gear_a.teeth').value, z = T(gear).value, want = a / z;
      return {value: Math.abs(run(name).factor), target: want, tol: want * 0.001, note: 'Speed against S gear A; tooth ratio ' + a + '/' + z + '. Motion rig: ' + run(name).expression};
    });
  for (const name of ['FR gear A', 'secondary gear', 'third gear cam', 'middle pulley and primary pinion', 'FR pulley and tyre', 'motor rotor and pulley'])
    add('motion', 'ratio.' + name.replaceAll(' ', '_'), {cls: ''}, () => ({value: run(name).factor, note: 'Motion rig: ' + run(name).expression + '. No target yet.'}));
  for (const [id, part] of [['tyre.fr_pulley.od', 'DRV-023'], ['tyre.fwd_pulley.od', 'FWD-021'], ['pinch_roller.od', 'BAY-061']]) direct('motion', id, id, () => rp[part].diameter_x);
  for (const [id, part, free] of [['belt.main.stretch', 'BLT-001', 'belt.main.free_length'], ['belt.second.stretch', 'BLT-002', 'belt.second.free_length']])
    add('motion', id, {target: free, uses: ['belt.stretch_range'], unit: '%', parts: [part]}, () => {
      const [lo, hi] = T('belt.stretch_range').range, length = g.belts[part].centreline_length_mm;
      return {value: (length / T(free).value - 1) * 100, lo, hi, note: 'Installed centreline ' + length.toFixed(1) + ' mm against a free length of ' + T(free).value + ' mm.'};
    });
  for (const mode of ['ff', 'rew'])
    add('motion', 'fr_pulley.touches_flywheel_in_' + mode, {uses: ['tyre.fr_pulley.od'], unit: 'mm', cls: 'documented', parts: ['DRV-023', 'MEC-011'], note: 'Gap from the flywheel rim to a tyre of the target size; friction drive needs slight compression.'},
      () => ({value: dist(centre(mode, 'DRV-023'), centre(mode, 'MEC-011')) - flyR() - T('tyre.fr_pulley.od').value / 2, lo: -0.3, hi: 0.0}));
  add('motion', 'fr_pulley.flywheel_plus_tyre_radius', {target: 'contact.fr_pulley_to_capstan_axis_engaged', unit: 'mm', note: 'Model flywheel rim radius plus model tyre radius, against the axle-to-capstan distance Sony shows at engagement.'},
    () => { const p = T('contact.fr_pulley_to_capstan_axis_engaged'); return {value: flyR() + rp['DRV-023'].diameter_x / 2, target: p.value, tol: p.tol}; });
  for (const [part, label, modes] of [['DRV-023', 'fr_pulley', ['ff', 'rew']], ['DRV-012', 'fr_gear_a', ['ff', 'rew']], ['FWD-021', 'fwd_pulley', ['play']], ['BAY-061', 'pinch_roller', ['play']]])
    add('motion', label + '.moves_between_modes', {unit: 'mm', cls: 'documented', parts: [part], note: 'Largest shift from STOP in ' + modes.join('/').toUpperCase() + '; this axis is carried on a lever and has to move.'},
      () => ({value: Math.max(...modes.map(m => dist(centre(m, part), centre('stop', part)))), lo: 0.2}));
  add('motion', 'fr_gear_a.swings_between_ff_and_rew', {unit: 'mm', cls: 'documented', parts: ['DRV-012'], note: 'FF sends drive to the take-up side, REW to the supply side, by swinging this gear.'},
    () => ({value: dist(centre('ff', 'DRV-012'), centre('rew', 'DRV-012')), lo: 0.5}));
  add('motion', 'pinch_roller.meets_capstan_in_play', {uses: ['pinch_roller.od', 'capstan.diameter'], unit: 'mm', cls: 'documented', parts: ['BAY-061', 'BAY-052'], note: 'Roller-to-capstan gap in PLAY at the target roller and capstan sizes.'},
    () => ({value: dist(centre('play', 'BAY-061'), centre('play', 'MEC-011')) - T('pinch_roller.od').value / 2 - T('capstan.diameter').value / 2, lo: -0.5, hi: 0.0}));

  // ---------- sizes: a target may ask for one part's size along a model axis, or its longest length
  // Width, depth and height are the box around the part along the model's axes, so they suit only parts
  // that sit square to the model. "longest" is the greatest distance between two points and suits any angle.
  for (const t of file.targets) if (t.measure) {
    // A cassette part exists twice. Unless the target says "variant": "detailed", the cassette in the Blender file is measured.
    const variant = t.variant || (t.measure.size_of in (measured.cassette_detailed || {}) ? 'original' : null), from = variant === 'detailed' ? measured.cassette_detailed : measured.parts;
    add('size', 'size.' + t.id, {target: t.id, unit: 'mm', parts: [t.measure.size_of], variant, note: (t.measure.along === 'longest' ? 'Longest length' : t.measure.along[0].toUpperCase() + t.measure.along.slice(1) + ' along the model\'s axes') + ' of ' + t.measure.size_of + '.'}, () => {
      const m = from[t.measure.size_of], value = t.measure.along === 'longest' ? m.longest_length_mm : m.size_mm[SIZE_AXES[t.measure.along]];
      return 'range' in t ? {value, lo: t.range[0], hi: t.range[1]} : {value, target: t.value, tol: t.tol};
    });
  }
  return checks;
}

/** Each target's outcome: pass, fail, no data, or no check. With a variant, checks made on the other cassette variant do not count. */
export function targetOutcome(checks, targetId, variant = null) {
  const own = checks.filter(c => c.target === targetId && (!c.variant || !variant || c.variant === variant));
  if (!own.length) return {status: 'no check', checks: []};
  const status = own.some(c => c.status === 'fail') ? 'fail' : own.some(c => c.status !== 'pass') ? 'no data' : 'pass';
  return {status, checks: own};
}

export function summarise(checks) {
  const summary = {};
  for (const c of checks) { summary[c.group] ??= {pass: 0, fail: 0, info: 0, 'no data': 0}; summary[c.group][c.status]++; }
  return summary;
}
