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
  direct('envelope', 'body.front_width', 'body.front_width', () => front()[1] - front()[0], {note: 'From the plain side\'s outer wall to the control side\'s side face within 3 mm of the front plane, so the rounded edges count and the side keys, rail, MIC grille and trim do not.'});
  direct('envelope', 'body.width', 'body.width', () => front()[1] - front()[0], {note: 'Across the front face, as body.front_width is measured: the two targets are two sources for one width. The control-side panel bulges a further 1.2 mm, counted as projecting.'});
  direct('envelope', 'body.depth', 'body.depth', () => Math.max(...['EXT-010', 'EXT-020', 'EXT-040'].map(p => P[p][1][1])) - Math.min(...['EXT-020', 'EXT-030'].map(p => P[p][0][1])), {parts: ['EXT-010', 'EXT-020', 'EXT-030', 'EXT-040']});
  direct('envelope', 'front.silver_strip', 'front.silver_strip', () => front()[1] - blueRight(), {parts: ['GRL-001']});
  direct('envelope', 'front.top_band', 'front.top_band', () => P['EXT-020'][1][2] - P['EXT-020'][0][2]);
  direct('envelope', 'cover.control_side_face_width', 'cover.control_side_face_width', () => g.controls.side_face_y[1] - g.controls.side_face_y[0], {parts: ['GRL-001'], note: 'The grille\'s control-side face across the body, between where its two rounded long edges begin, as the bare cover was measured lying flat.'});
  direct('envelope', 'control.listen_key_proud_of_side', 'control.listen_key_proud_of_side', () => g.controls.listen_key_x - g.controls.side_face_x, {parts: ['CTL-03', 'GRL-001'], note: 'The LISTEN key at rest, from its face to the grille\'s outer side face beside the volume slot.'});
  direct('envelope', 'window.opening_width', 'window.opening_width', () => pane()[1][0] - pane()[0][0], {note: 'Model has a flat pane and a printed surround, no bevelled opening; the pane is compared.'});
  direct('envelope', 'window.opening_height', 'window.opening_height', () => pane()[1][2] - pane()[0][2]);
  direct('envelope', 'window.right_edge_to_strip', 'window.right_edge_to_strip', () => blueRight() - pane()[1][0], {parts: ['EXT-031']});
  direct('envelope', 'window.bottom_to_body_bottom', 'window.bottom_to_body_bottom', () => pane()[0][2] - ex.union[0][2], {parts: ['EXT-031']});
  // Proportions read from photographs, which do not depend on any one scale.
  const bodyDepth = () => Math.max(...['EXT-010', 'EXT-020', 'EXT-040'].map(p => P[p][1][1])) - Math.min(...['EXT-020', 'EXT-030'].map(p => P[p][0][1]));
  const lidW = () => P['EXT-030'][1][0] - P['EXT-030'][0][0], lidH = () => P['EXT-030'][1][2] - P['EXT-030'][0][2];
  direct('envelope', 'body.depth_over_width', 'body.depth_over_width', () => bodyDepth() / (front()[1] - front()[0]), {parts: ['EXT-010', 'EXT-020', 'EXT-030', 'GRL-001'], note: 'Depth as body.depth is measured, over the width across the front face.'});
  add('envelope', 'body.depth_minimum_from_stack', {target: 'body.depth_minimum_from_stack', unit: 'mm', parts: ['EXT-010', 'EXT-020', 'EXT-030', 'EXT-040'], note: 'The body\'s depth, as body.depth is measured, against the least that holds a cassette, an AA cell and the thinnest lid, separator and door.'},
    () => ({value: bodyDepth(), lo: T('body.depth_minimum_from_stack').value}));
  direct('envelope', 'lid.height_over_width', 'lid.height_over_width', () => lidH() / lidW(), {parts: ['EXT-030'], note: 'The cassette lid\'s outline in the model.'});
  direct('envelope', 'lid.window_centre_fraction_of_lid_width', 'lid.window_centre_fraction_of_lid_width', () => ((pane()[0][0] + pane()[1][0]) / 2 - P['EXT-030'][0][0]) / lidW(), {parts: ['EXT-030', 'EXT-031'], note: 'From the lid\'s plain-side edge to the window pane\'s centre, over the lid\'s width.'});
  direct('envelope', 'window.left_margin', 'window.left_margin', () => pane()[0][0] - P['EXT-030'][0][0], {parts: ['EXT-031', 'EXT-030']});
  // The cassette measured here is the one in the Blender file (the "original" variant).
  const cassette = () => { const shells = [ex['MEDIA-001'], ex['MEDIA-002']]; return {lo: [0, 1, 2].map(i => Math.min(...shells.map(c => c[0][i]))), hi: [0, 1, 2].map(i => Math.max(...shells.map(c => c[1][i])))}; };
  direct('envelope', 'cassette.thickness_body', 'cassette.thickness_body', () => g.cassette_fit.body_depth[1] - g.cassette_fit.body_depth[0], {variant: 'original', parts: ['MEDIA-001', 'MEDIA-002'], note: 'Thickness of the cassette shells away from the head band (X below 5 mm).'});
  add('envelope', 'cassette.head_band_clears_the_carriage_plate', {unit: 'mm', cls: 'standard', parts: ['MEDIA-002', 'HDC-001'], note: 'Gap between the back of the cassette\'s head band and the head-carriage plate under it, at rest.'},
    () => ({value: g.cassette_fit.band_to_plate, lo: 0.05}));
  direct('envelope', 'tape.plane_above_carriage_plate', 'tape.plane_above_carriage_plate', () => g.cassette_fit.tape_plane_above_plate, {parts: ['MEDIA-004', 'HDC-001'], note: 'From the head-carriage plate to the middle of the tape pack.'});
  direct('envelope', 'bay.cassette_to_chassis_end_battery', 'bay.cassette_to_chassis_end_battery', () => cassette().lo[2] - ex['BAY-071'][0][2], {variant: 'original', parts: ['MEDIA-001', 'BAY-071'], note: 'From the cassette\'s battery end to the outer edge of the bay\'s battery-end support.'});
  direct('envelope', 'bay.top_rail_outer_edge_beyond_cassette_end', 'bay.top_rail_outer_edge_beyond_cassette_end', () => ex['BAY-073'][1][2] - cassette().hi[2], {variant: 'original', parts: ['MEDIA-001', 'BAY-073']});
  direct('envelope', 'bay.top_rail_top_above_cassette_top_face', 'bay.top_rail_top_above_cassette_top_face', () => g.cassette_fit.body_depth[0] - ex['BAY-073'][0][1], {variant: 'original', parts: ['MEDIA-001', 'BAY-073'], note: 'Above the cassette\'s thin face, toward the lid.'});
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
  for (const [id, targetId, pivot] of [['reverse_wheel_axis', 'axis.reverse_wheel', 'reverse_wheel'], ['fr_gear_b_axis', 'axis.fr_gear_b', 'fr_gear_b'], ['middle_pulley_axis', 'axis.middle_pulley', 'middle_pulley'], ['third_gear_axis', 'axis.third_gear', 'third_gear'], ['shutoff_post_axis', 'axis.shutoff_post', 'shutoff_post']])
    add('axes', id, {target: targetId, unit: 'mm'}, () => { const p = T(targetId), m = uv(xz(pv[pivot])); return {value: dist(m, p.value), target: 0.0, tol: p.tol, note: 'Model at u,v = ' + place(m) + '; target ' + JSON.stringify(p.value) + '.'}; });
  const centre = (mode, part) => g.modes[mode].parts[part].centre_xz;
  for (const [id, targetId, part, mode] of [['fr_pulley_axis_ff', 'axis.fr_pulley_engaged', 'DRV-023', 'ff'], ['fr_pulley_axis_rew', 'axis.fr_pulley_engaged', 'DRV-023', 'rew'],
    ['fr_pulley_axis_play', 'axis.fr_pulley_released', 'DRV-023', 'play'], ['fr_gear_a_axis_ff', 'axis.fr_gear_a_ff', 'DRV-012', 'ff'], ['fr_gear_a_axis_rew', 'axis.fr_gear_a_rew', 'DRV-012', 'rew'],
    ['fr_gear_a_axis_play', 'axis.fr_gear_a_play', 'DRV-012', 'play'], ['fwd_pulley_axis_play', 'axis.fwd_pulley_engaged', 'FWD-021', 'play']])
    add('axes', id, {target: targetId, unit: 'mm'}, () => { const p = T(targetId), m = uv(centre(mode, part)); return {value: dist(m, p.value), target: 0.0, tol: p.tol, note: mode.toUpperCase() + ': model at u,v = ' + place(m) + '; target ' + JSON.stringify(p.value) + '.'}; });
  direct('motion', 'pinch_roller.width', 'pinch_roller.width', () => rp['BAY-061'].depth_y[1] - rp['BAY-061'].depth_y[0], {parts: ['BAY-061']});
  direct('motion', 'belt.length_ratio_main_to_second', 'belt.length_ratio_main_to_second', () => g.belts['BLT-001'].centreline_length_mm / g.belts['BLT-002'].centreline_length_mm, {parts: ['BLT-001', 'BLT-002']});
  // Sony's caution when installing the motor: the third gear's rim stands just 0.5 mm from the end face of the motor pulley.
  direct('axes', 'third_gear_to_motor_pulley', 'clearance.third_gear_to_motor_pulley', () => rp['MTR-005'].bounds[0][2] - (xz(pv.third_gear)[1] + g.gears['CAM-010'][0].tip_radius), {parts: ['CAM-010', 'MTR-005']});
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
  // Fast winding: one side of a C-60 is 30 minutes of tape about 18 micrometres thick on a hub of about 11 mm; the driven reel turns at a fixed rate.
  const c60Turns = () => { const hub = 11.0, thick = 0.018; return (Math.sqrt(hub * hub + T('tape.speed').value * 1800 * thick / Math.PI) - hub) / thick; };
  for (const [id, reel, mode, what] of [['wind.c60_time', 'takeup', 'ff', 'take-up reel, at its FF rate'], ['wind.c60_time_rew', 'supply', 'rew', 'supply reel, at its REW rate']])
    add('motion', id, {target: 'wind.c60_time', uses: ['tape.speed'], unit: 's', parts: ['DRV-014', 'DRV-012', 'DRV-023', 'MEC-011'], note: 'Time for the ' + what + ', to make the turns that one side of a C-60 needs (about 763). The rate follows from the flywheel through the tyre and gears without slip, with the motor at its winding speed.'},
      () => { const p = T('wind.c60_time'); return {value: 2 * Math.PI * c60Turns() / Math.abs(rates[reel][mode]), target: p.value, tol: p.tol}; });
  direct('motion', 'motor.speed_while_winding', 'motor.speed_while_winding', () => Math.abs(fly().ff - fly().rew) < 1e-9 ? fly().ff / fly().play : NaN, {parts: ['MTR-004', 'MEC-011']});
  add('motion', 'fr_pulley.slip_while_winding', {target: 'fr_pulley.slip_while_winding', unit: '%', parts: ['DRV-023', 'MEC-011'], note: 'How much slower the FF/REW tyre\'s surface runs than the flywheel\'s front disc, in FF and in REW.'}, () => {
    const pulley = run('FR pulley and tyre').by_mode, tyre = rp['DRV-023'].diameter_x / 2, t = T('fr_pulley.slip_while_winding');
    const slip = [[pulley.ff * rates.takeup.ff, fly().ff], [pulley.rew * rates.supply.rew, fly().rew]].map(([w, f]) => (1 - Math.abs(w) * tyre / (Math.abs(f) * flyR())) * 100);
    return {value: Math.max(...slip), target: t.value, tol: t.tol, note: 'FF ' + slip[0].toFixed(2) + ' %, REW ' + slip[1].toFixed(2) + ' %.'};
  });
  // The take-up clutch: the pressed-on parts turn with the reel, the FWD pulley drives the drum in PLAY only, and the drum outruns the reel.
  const PRESSED = ['BAY-020', 'BAY-030', 'DRV-104', 'DRV-014', 'CLT-010', 'CLT-031', 'CLT-032'], fwd = () => g.fwd_drive;
  const drumRate = () => run('take-up drive drum').factor * fly().play;
  add('motion', 'clutch.pressed_parts_turn_with_reel', {unit: 'parts', cls: 'reported', parts: PRESSED, note: 'Parts pressed on the take-up shaft that the motion rig does not turn with the reel.'},
    () => { const odd = PRESSED.filter(id => !['take-up clutch', 'take-up rotating members'].includes(g.carried_by[id])); return {value: odd.length, target: 0, tol: 0, parts: odd.length ? odd : PRESSED}; });
  add('motion', 'clutch.drum_outruns_reel_in_play', {uses: ['tape.speed'], unit: 'rad/s', cls: 'designed', parts: ['CLT-030', 'DRV-014'], note: 'The drum the FWD pulley drives must turn faster than the reel ever needs (tape speed over an empty hub of about 11 mm), in the same direction, so the felt always slips.'},
    () => ({value: drumRate() * Math.sign(rates.takeup.play), lo: T('tape.speed').value / 11.0}));
  add('motion', 'clutch.drive_rolls_without_slipping', {unit: '%', cls: 'designed', parts: ['DRV-020', 'FWD-021', 'CLT-030'], note: 'Largest difference between the surface speeds of the middle pulley, the FWD tyre and the drum in PLAY.'},
    () => { const v = [run('middle pulley and primary pinion').factor * fwd().middle_pulley_radius, run('FWD idler').factor * fwd().tyre_radius, run('take-up drive drum').factor * fwd().drum_radius].map(Math.abs); return {value: (Math.max(...v) / Math.min(...v) - 1) * 100, lo: 0, hi: 1}; });
  const tyreGap = (mode, axis, radius) => dist(centre(mode, 'FWD-021'), axis) - radius - fwd().tyre_radius;
  add('motion', 'fwd_pulley.presses_drum_in_play', {unit: 'mm', cls: 'documented', parts: ['FWD-021', 'CLT-030'], note: 'Gap from the FWD tyre to the drum in PLAY; a friction drive needs slight compression.'}, () => ({value: tyreGap('play', tu(), fwd().drum_radius), lo: -0.3, hi: 0.0}));
  add('motion', 'fwd_pulley.presses_middle_pulley_in_play', {unit: 'mm', cls: 'documented', parts: ['FWD-021', 'DRV-020'], note: 'Gap from the FWD tyre to the middle pulley in PLAY.'}, () => ({value: tyreGap('play', xz(pv.middle_pulley), fwd().middle_pulley_radius), lo: -0.3, hi: 0.0}));
  for (const mode of ['stop', 'ff', 'rew'])
    add('motion', 'fwd_pulley.clear_of_drum_in_' + mode, {unit: 'mm', cls: 'documented', parts: ['FWD-021', 'CLT-030'], note: 'Gap from the FWD tyre to the drum in ' + mode.toUpperCase() + '; Sony marks a clearance.'}, () => ({value: tyreGap(mode, tu(), fwd().drum_radius), lo: 0.2}));
  // The take-up clutch as a friction joint. The spring's force follows from its wire, coils and how far it is compressed; the felt's torque from
  // that force, its friction and its mean radius. The spring's free length and the friction are design figures, so this shows the modelled parts
  // can give Sony's torque; it is not a measurement of a unit.
  const st = () => g.takeup_stack, GCM = 10.197;      // g.cm per N.mm
  // Pinch pressure from the pinch lever's torsion spring as modelled: its rate (E d^4 / 64 D n) times its wind-up in PLAY (the designed
  // preload plus the lever's swing as the roller meets the capstan), over the lever's arm to the roller's axle.
  add('motion', 'pinch.pressure', {target: 'pinch.pressure', uses: ['pinch.spring.preload', 'spring.steel_youngs_modulus'], unit: 'g', cls: 'designed', parts: ['HDC-024', 'HDC-020', 'BAY-061'], note: 'Force of the pinch roller on the capstan in PLAY from the torsion spring as modelled; the preload is a design figure.'},
    () => { const sp = g.pinch_spring, d = sp.wire, D = sp.mean_coil, n = (sp.height - d) / d, pivot = m => g.modes[m].parts['HDC-022'].centre_xz, axle = m => g.modes[m].parts['HDC-021'].centre_xz;
      const angle = m => Math.atan2(axle(m)[1] - pivot(m)[1], axle(m)[0] - pivot(m)[0]), swing = Math.abs(angle('play') - angle('stop')), arm = dist(axle('play'), pivot('play'));
      const wind = T('pinch.spring.preload').value * Math.PI / 180 + swing, torque = T('spring.steel_youngs_modulus').value * d ** 4 * wind / (64 * D * n), [lo, hi] = T('pinch.pressure').range;
      return {value: torque / arm / 9.80665 * 1000, lo, hi, note: 'Spring ' + d.toFixed(2) + ' mm wire, ' + D.toFixed(2) + ' mm mean coil, ' + n.toFixed(2) + ' turns, wound ' + (wind * 180 / Math.PI).toFixed(1) + ' degrees in PLAY; arm ' + arm.toFixed(2) + ' mm; wire stress ' + (32 * torque / (Math.PI * d ** 3) / 1000).toFixed(2) + ' GPa.'}; });
  // Back tension from S gear B's brake: the spring's rate G d^4 / (8 D^3 n) times its compression presses the gear on its felt; the felt's
  // friction at its mean radius brakes the gear, and the gear pair passes that to the supply reel as 40:60.
  add('motion', 'torque.back_tension', {target: 'torque.back_tension', uses: ['back_tension.spring.free_length', 'back_tension.spring.active_coils', 'clutch.felt.friction', 'spring.steel_shear_modulus', 'gear.s_gear_a.teeth', 'gear.s_gear_b.teeth'], unit: 'g.cm', cls: 'designed', parts: ['SBT-010', 'SBT-011', 'DRV-011', 'DRV-010'],
    note: 'Torque that holds the supply reel back in PLAY. The spring\'s free length and the felt\'s friction are design figures.'}, () => {
    const b = g.back_tension, d = b.wire, D = b.mean_coil, k = T('spring.steel_shear_modulus').value * d ** 4 / (8 * D ** 3 * T('back_tension.spring.active_coils').value), force = k * (T('back_tension.spring.free_length').value - b.height);
    const [ri, ro] = b.felt_radius, mean = 2 / 3 * (ro ** 3 - ri ** 3) / (ro ** 2 - ri ** 2), atGear = T('clutch.felt.friction').value * force * mean, atReel = atGear * T('gear.s_gear_a.teeth').value / T('gear.s_gear_b.teeth').value;
    const [lo, hi] = T('torque.back_tension').range;
    return {value: atReel / 9.80665 * 1000 / 10, lo, hi, note: 'Spring ' + d.toFixed(2) + ' mm wire, ' + D.toFixed(2) + ' mm mean coil, compressed ' + (T('back_tension.spring.free_length').value - b.height).toFixed(2) + ' mm: ' + (force / 9.80665 * 1000).toFixed(0) + ' g on the felt (' + ri.toFixed(2) + '-' + ro.toFixed(2) + ' mm).'};
  });
  add('motion', 'torque.takeup_play', {target: 'torque.takeup_play', uses: ['clutch.spring.free_length', 'clutch.spring.active_coils', 'clutch.felt.friction', 'spring.steel_shear_modulus'], unit: 'g.cm', cls: 'designed', parts: ['CLT-031', 'CLT-010', 'CLT-030', 'CLT-032'],
    note: 'Torque the felt passes in PLAY: spring rate G d^4 / (8 D^3 n) times its compression, times the felt\'s friction and mean radius. Free length and friction are design figures.'}, () => {
    const sp = st()['CLT-031'], felt = st()['CLT-010'], d = sp.radius[1] - sp.radius[0], D = sp.radius[1] + sp.radius[0], installed = sp.depth[1] - sp.depth[0];
    const k = T('spring.steel_shear_modulus').value * d ** 4 / (8 * D ** 3 * T('clutch.spring.active_coils').value), force = k * (T('clutch.spring.free_length').value - installed);
    const [ri, ro] = felt.radius, mean = 2 / 3 * (ro ** 3 - ri ** 3) / (ro ** 2 - ri ** 2), [lo, hi] = T('torque.takeup_play').range;
    return {value: T('clutch.felt.friction').value * force * mean * GCM, lo, hi};
  });
  add('motion', 'clutch.felt_is_squeezed', {unit: 'mm', cls: 'designed', parts: ['CLT-010', 'CLT-030', 'DRV-014'], note: 'How far the drum\'s face stands into the felt: the friction faces must bear on each other, not stand apart.'},
    () => ({value: st()['CLT-010'].depth[1] - st()['CLT-030'].depth[0], lo: 0.01, hi: 0.1}));
  add('motion', 'clutch.spring_bears_on_its_seat', {unit: 'mm', cls: 'designed', parts: ['CLT-031', 'CLT-032'], note: 'How far the spring\'s end coil stands into the brass seat it presses on; its other end stands the same way in the drum\'s well.'},
    () => ({value: st()['CLT-031'].depth[1] - st()['CLT-032'].depth[0], lo: 0.001, hi: 0.05}));
  add('motion', 'clutch.pressed_parts_grip_the_shaft', {unit: 'mm', cls: 'designed', parts: ['DRV-104', 'BAY-020', 'DRV-014', 'CLT-032', 'CLT-030'], note: 'Least interference between the shaft and the bores pressed on it (reel table, gear, spring seat). The drum must be free on the shaft instead.'},
    () => { const shaft = st()['DRV-104'].radius[1]; return {value: st()['CLT-030'].radius[0] - shaft > 0.05 ? Math.min(...['BAY-020', 'DRV-014', 'CLT-032'].map(id => shaft - st()[id].radius[0])) : -1, lo: 0.001, hi: 0.02}; });
  add('motion', 'takeup.shaft_endplay', {unit: 'mm', cls: 'designed', parts: ['DRV-104', 'BAY-020', 'CLT-020', 'CLT-021', 'DRV-204', 'DRV-014'], note: 'Room for the shaft to move along its axis: the space between the reel table and the gear, less the bush and the two thrust washers that stand in it.'},
    () => { const t = id => st()[id].depth[1] - st()[id].depth[0]; return {value: st()['DRV-014'].depth[0] - st()['BAY-020'].depth[1] - t('CLT-020') - t('CLT-021') - t('DRV-204'), lo: 0.05, hi: 0.2}; });
  // Fast-wind torque from lever (B)'s spring: in FF the spring (rate G d^4 / 8 D^3 n, stretched from its free length) turns lever (B) about
  // FR gear B's axis and presses the tyre on the flywheel; the tyre's grip at its radius, through the 28:60 gearing, is the torque at the take-up.
  add('motion', 'torque.fast_wind_min', {target: 'torque.fast_wind_min', uses: ['lever_b.spring.free_length', 'lever_b.spring.active_coils', 'fr_tyre.friction', 'spring.steel_shear_modulus'], unit: 'g.cm', cls: 'designed', parts: ['FRL-021', 'FRL-001', 'DRV-023', 'MEC-011'],
    note: 'Most torque the take-up can get in FF before the tyre slips. The spring\'s free length and the tyre\'s friction are design figures; friction at the contact is left out of lever (B)\'s balance.'}, () => {
    const s = g.lever_b_spring, bx = xz(pv.fr_gear_b), axle = m => g.modes[m].parts['DRV-107'].centre_xz, ang = (p, c) => Math.atan2(p[1] - c[1], p[0] - c[0]);
    const swing = ang(axle('ff'), bx) - ang(axle('stop'), bx), r = [s.hook[0] - bx[0], s.hook[1] - bx[1]], hookFF = [bx[0] + r[0] * Math.cos(swing) - r[1] * Math.sin(swing), bx[1] + r[0] * Math.sin(swing) + r[1] * Math.cos(swing)];
    const L = dist(s.post, hookFF), f = [(s.post[0] - hookFF[0]) / L, (s.post[1] - hookFF[1]) / L], d = s.wire, D = s.mean_coil;
    const k = T('spring.steel_shear_modulus').value * d ** 4 / (8 * D ** 3 * T('lever_b.spring.active_coils').value), pull = k * (L - T('lever_b.spring.free_length').value);
    const armS = Math.abs((hookFF[0] - bx[0]) * f[1] - (hookFF[1] - bx[1]) * f[0]), P = axle('ff'), toP = dist(P, cap()), n = [(P[0] - cap()[0]) / toP, (P[1] - cap()[1]) / toP];
    const armN = Math.abs((P[0] - bx[0]) * n[1] - (P[1] - bx[1]) * n[0]), press = pull * armS / armN, rTyre = rp['DRV-023'].diameter_x / 2;
    const torque = T('fr_tyre.friction').value * press * rTyre * g.gears['DRV-014'][0].teeth / g.gears['DRV-021'][0].teeth;
    return {value: torque * GCM, lo: T('torque.fast_wind_min').value, note: 'Spring ' + d.toFixed(2) + ' mm wire, ' + D.toFixed(2) + ' mm mean coil, ' + L.toFixed(2) + ' mm long in FF: ' + (pull / 9.80665 * 1000).toFixed(0) + ' g pull, ' + (press / 9.80665 * 1000).toFixed(0) + ' g on the flywheel.'};
  });
  add('motion', 'torque.fast_wind_needs_tyre_force', {target: null, uses: ['torque.fast_wind_min'], unit: 'g', cls: 'documented', parts: ['DRV-023', 'MEC-011'], note: 'Info: the force with which the FF/REW tyre must be pressed on the flywheel to pass Sony\'s least fast-wind torque in FF, taking rubber on brass at 0.8. Lever (B)\'s spring is modelled and checked by torque.fast_wind_min; this figure is the required tyre force, not a separate spring check.'},
    () => ({value: T('torque.fast_wind_min').value / GCM * (g.gears['DRV-021'][0].teeth / g.gears['DRV-014'][0].teeth) / (rp['DRV-023'].diameter_x / 2) / 0.8 / 9.80665 * 1000, info: true}));
  // The gear beside the take-up spindle, which the friction gear's 42-tooth ring drives.
  direct('axes', 'gear.takeup.step_mate', 'gear.takeup.step_mate', () => dist(xz(pv.step_mate), tu()), {parts: ['DRV-017', 'DRV-014']});
  direct('motion', 'teeth.step_mate', 'gear.step_mate.teeth', () => g.gears['DRV-017'][0].teeth, {unit: 'teeth', parts: ['DRV-017'], note: 'Counted on the model\'s own outline.'});
  add('motion', 'gear.step_mate_meshes_with_the_42_tooth_ring', {uses: ['gear.takeup.step_teeth', 'gear.step_mate.teeth', 'gear.module'], unit: '%', cls: 'photo-measured', parts: ['DRV-017', 'DRV-014'], note: 'Larger of two mismatches: tooth speed of the gear against the ring that drives it, and its distance from the take-up axis against where their teeth mesh.'},
    () => { const z = g.gears['DRV-017'][0].teeth, ring = T('gear.takeup.step_teeth').value, mesh = T('gear.module').value * (z + ring) / 2;
      return {value: Math.max(Math.abs(Math.abs(run('gear beside the take-up').factor) * z / ring - 1), Math.abs(dist(xz(pv.step_mate), tu()) / mesh - 1)) * 100, lo: 0, hi: 0.1}; });
  // The gears behind the middle pulley: counted on the model, they must turn tooth for tooth and stand where their teeth mesh.
  // The pinion on the middle pulley drives the wheel of the second gear; the second gear's own pinion drives the third gear.
  const zIn = (id, k) => g.gears[id][k].teeth, TRAIN_PARTS = ['DRV-015', 'DRV-016', 'CAM-010'];
  const MESHES = [[['middle_pulley', 'DRV-015', 0, 'middle pulley and primary pinion'], ['secondary_gear', 'DRV-016', 0, 'secondary gear']], [['secondary_gear', 'DRV-016', 1, 'secondary gear'], ['third_gear', 'CAM-010', 0, 'third gear cam']]];
  add('motion', 'gear.third_train_moves_tooth_for_tooth', {unit: '%', cls: 'designed', parts: TRAIN_PARTS, note: 'Largest mismatch of tooth speed in the two meshes: the pulley\'s pinion with the second gear\'s wheel, the second gear\'s pinion with the third gear.'},
    () => ({value: Math.max(...MESHES.map(pair => { const v = pair.map(([, id, k, name]) => Math.abs(run(name).factor) * zIn(id, k)); return Math.max(...v) / Math.min(...v) - 1; })) * 100, lo: 0, hi: 0.1}));
  add('motion', 'gear.third_train_stands_in_mesh', {uses: ['gear.module'], unit: 'mm', cls: 'designed', parts: TRAIN_PARTS, note: 'Largest departure of the two centre distances from where the counted teeth mesh.'},
    () => ({value: Math.max(...MESHES.map(([[pa, ia, ka], [pb, ib, kb]]) => Math.abs(dist(xz(pv[pa]), xz(pv[pb])) - T('gear.module').value * (zIn(ia, ka) + zIn(ib, kb)) / 2))), lo: 0, hi: 0.05}));
  // Automatic shut-off (Sony service manual p.3): the lever's teeth must stay clear of the third gear while the reel turns, mesh when it stalls,
  // be carried along by the gear, and turn release lever C only then.
  // The lever's toothed piece meets the small pinion under the third gear (its second ring of teeth).
  const so = () => g.shut_off, pin3 = () => g.gears['CAM-010'][1], SHUT = ['STF-012', 'STF-010', 'CAM-010', 'CLT-040', 'RLC-001'];
  const pinModule = () => 2 * pin3().tip_radius / (pin3().teeth + 2);
  add('motion', 'shutoff.clear_while_reel_turns', {unit: 'mm', cls: 'documented', parts: SHUT, note: 'Smallest gap between the toothed piece and the tips of the pinion under the third gear in normal running: held back by the detection lever, at the rib\'s push, and at rest in STOP. If they touched it would trip with tape left.'},
    () => ({value: Math.min(so().held.reach, so().out.reach, so().rest.reach) - pin3().tip_radius, lo: 0.1}));
  add('motion', 'shutoff.meshes_when_reel_stalls', {unit: 'mm', cls: 'documented', parts: SHUT, note: 'How deep the toothed piece stands among the pinion\'s teeth once the detection lever has fallen back (it must then be unswung). A tooth of the pinion is 2.25 modules deep.'},
    () => ({value: Math.abs(so().meshed.detector_deg) < 0.01 && Math.abs(so().held.detector_deg) > 3 ? pin3().tip_radius - so().meshed.reach : 0, lo: 0.4, hi: 0.8}));
  add('motion', 'shutoff.gear_carries_lever', {unit: 'teeth', cls: 'documented', parts: SHUT, note: 'How far the pinion drives the meshed toothed piece along the lever before it lets go, in teeth of the pinion.'},
    () => ({value: dist(so().tripped.centre_xz, so().meshed.centre_xz) / (Math.PI * pinModule()), lo: 2, hi: 4}));
  add('motion', 'shutoff.release_lever_turns_only_when_tripped', {unit: 'deg', cls: 'documented', parts: SHUT, note: 'Turn of release lever C when the toothed piece has been driven along; it must not move at any earlier stage.'},
    () => ({value: ['rest', 'held', 'out', 'meshed'].every(k => Math.abs(so()[k].release_deg) < 0.01) ? Math.abs(so().tripped.release_deg) : 0, lo: 3}));
  add('motion', 'shutoff.piece_pushes_release_lever', {unit: 'mm', cls: 'designed', parts: ['STF-012', 'RLC-001'], note: 'Gap between the toothed piece\'s tail and release lever C\'s input arm once the piece has been driven and release lever C turned: the tail must be what turns it.'},
    () => ({value: so().tripped.to_release, lo: 0, hi: 0.15}));
  add('motion', 'shutoff.release_lever_untouched_before_the_drive', {unit: 'mm', cls: 'designed', parts: ['STF-012', 'RLC-001'], note: 'Smallest gap between the toothed piece and release lever C at rest, held back, pushed out by the rib and in mesh.'},
    () => ({value: Math.min(...['rest', 'held', 'out', 'meshed'].map(k => so()[k].to_release)), lo: 0.3}));
  add('motion', 'shutoff.rib_rocks_the_lever', {unit: 'mm', cls: 'documented', parts: ['STF-010', 'CAM-010'], note: 'How far the far side of the rib on the third gear pushes the lever\'s blade out from where the detection lever holds it, once a turn (Sony p.3, motion 2).'},
    () => ({value: so().rib_reach - so().held.blade, lo: 0.2, hi: 0.6}));
  add('motion', 'shutoff.pushed_out_by_the_rib', {unit: 'mm', cls: 'designed', parts: ['STF-010', 'CAM-010'], note: 'The lever\'s pushed-out stage against the rib\'s reach: the blade\'s foot should just meet the rib there.'},
    () => ({value: Math.abs(so().out.blade - so().rib_reach), lo: 0, hi: 0.05}));
  // FF and REW: the buttons' levers slide Lever (A) by cams on its follower posts, and its pin in the selector plate's slot swings FR gear A.
  const fr = () => g.ff_rew, FFREW = ['FCR-001', 'FCR-002', 'FRL-014', 'FRL-010', 'FRL-011', 'FRL-002'];
  add('motion', 'ffrew.ff_lever_drives_lever_a', {unit: 'mm', cls: 'designed', parts: FFREW, note: 'Gap between the FF lever\'s cam and its post on Lever (A) with FF pressed: the cam must be what has slid the bar (0.02 designed).'},
    () => ({value: fr().ff.ff_cam_to_posts[0], lo: 0, hi: 0.05}));
  add('motion', 'ffrew.rew_lever_drives_lever_a', {unit: 'mm', cls: 'designed', parts: FFREW, note: 'Gap between the REW lever\'s cam and its post on Lever (A) with REW pressed (0.02 designed).'},
    () => ({value: fr().rew.rew_cam_to_posts[0], lo: 0, hi: 0.05}));
  add('motion', 'ffrew.cams_clear_otherwise', {unit: 'mm', cls: 'designed', parts: FFREW, note: 'Smallest gap between either cam and either post at rest and with the other button pressed: a lever must not move the bar unless its own button is pressed.'},
    () => ({value: Math.min(...fr().rest.ff_cam_to_posts, ...fr().rest.rew_cam_to_posts, ...fr().rew.ff_cam_to_posts, ...fr().ff.rew_cam_to_posts, fr().ff.ff_cam_to_posts[1], fr().rew.rew_cam_to_posts[1]), lo: 0.08}));
  add('motion', 'ffrew.selector_pin_rides_in_its_slot', {unit: 'mm', cls: 'designed', parts: ['FRL-011', 'FRL-002'], note: 'Smallest gap between Lever (A)\'s pin and the walls of the selector plate\'s slot, at rest, in FF and in REW: the pin stays in the slot as the bar slides and gear A\'s arm swings (0.05 a side designed).'},
    () => ({value: Math.min(...['rest', 'ff', 'rew'].map(k => fr()[k].pin_to_slot_wall)), lo: 0.02, hi: 0.08}));
  add('motion', 'ffrew.lever_a_slides_opposite_ways', {unit: 'deg', cls: 'designed', parts: ['FRL-010'], note: 'Angle between the bar\'s movement for FF and for REW: FF and REW must drive it opposite ways along its length.'},
    () => { const d = k => [fr()[k].bar_centre_xz[0] - fr().rest.bar_centre_xz[0], fr()[k].bar_centre_xz[1] - fr().rest.bar_centre_xz[1]], a = d('ff'), b = d('rew');
      return {value: Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / Math.hypot(...a) / Math.hypot(...b)))) * 180 / Math.PI, lo: 179,
        note: 'FF slides it ' + Math.hypot(...a).toFixed(3) + ' mm, REW ' + Math.hypot(...b).toFixed(3) + ' mm, opposite ways along its length.'}; });
  // What stands up into the cassette (g.depth_stack, Y in mm, the lid side negative), against the depth stack fitted to two teardown photographs.
  const ds = () => g.depth_stack, mean = a => a.reduce((x, y) => x + y, 0) / a.length, capY = () => mean(ds().caps), DEPTH = ['BAY-030', 'BAY-031', 'BAY-020', 'BAY-021', 'BAY-050', 'BAY-051', 'BAY-052'];
  direct('axes', 'reel_table.cap_top_above_flange', 'reel_table.cap_top_above_flange', () => mean(ds().flanges) - capY(), {parts: DEPTH, note: 'Reel spindle cap above the brass reel flange\'s top face, both reels averaged.'});
  direct('axes', 'pin.locating_tip_above_reel_cap', 'pin.locating_tip_above_reel_cap', () => capY() - mean(ds().pin_tips), {parts: DEPTH});
  direct('axes', 'capstan.tip_above_reel_cap', 'capstan.tip_above_reel_cap', () => capY() - ds().capstan_tip, {parts: DEPTH});
  direct('axes', 'pin.locating_base_flange_below_reel_cap', 'pin.locating_base_flange_below_reel_cap', () => mean(ds().pin_flanges) - capY(), {parts: DEPTH, note: 'The cassette\'s head band rests on these flanges.'});
  add('axes', 'cassette.rests_on_locating_pins', {unit: 'mm', cls: 'standard', variant: 'original', parts: ['BAY-050', 'BAY-051', 'MEDIA-002'], note: 'Gap between the cassette\'s head band and the locating pins\' base flanges at rest: the standard supports a cassette on rings round its reference holes (ECMA-34 Fig. 5), and the depth stack puts the flanges at the band. 0.01 is shown.'},
    () => ({value: Math.min(...ds().pin_flanges) - ds().band_face, lo: 0, hi: 0.05}));
  // The locating pins stand in the cassette's reference holes and the capstan in its capstan hole, so they carry the standard's places.
  const pins = () => ds().pin_centres;
  direct('axes', 'cassette.reference_hole_pitch', 'cassette.reference_hole_pitch', () => dist(pins()[0], pins()[1]), {parts: ['BAY-050', 'BAY-051'], note: 'Between the two locating pins, which stand in the reference holes.'});
  direct('axes', 'cassette.reference_hole_row_to_reel_row', 'cassette.reference_hole_row_to_reel_row', () => mean(pins().map(p => p[0])) - tu()[0], {parts: ['BAY-050', 'BAY-051'], note: 'From the reel row to the locating pins\' row.'});
  direct('axes', 'cassette.capstan_pitch', 'cassette.capstan_pitch', () => 2 * Math.abs(cap()[1] - (tu()[1] + su()[1]) / 2), {parts: ['BAY-052'], note: 'Twice the capstan\'s distance from the cassette\'s centre line between the reels; the player has one capstan.'});
  direct('axes', 'flywheel.front_face_behind_pin_flange', 'flywheel.front_face_behind_pin_flange', () => ds().flywheel_front - mean(ds().pin_flanges), {parts: ['MEC-011', 'BAY-050', 'BAY-051'], note: 'The chassis base lies between them in the model; bringing the flywheel nearer needs the chassis plate worked out first.'});
  // Battery bay (g.battery): two R6 cells side by side.
  const bat = () => g.battery;
  add('parts', 'cell.aa_diameter_max', {target: 'cell.aa_diameter_max', unit: 'mm', parts: ['BAT-001', 'EXT-040', 'MEC-001'], note: 'Room across each cell\'s channel along the cell\'s body: twice the least distance from a cell\'s axis to anything rigid round it, sections every 1 mm. It must take the largest cell. The wires are left out; the pull ribbon, lying under the cells, is counted.'},
    () => ({value: 2 * Math.min(...bat().free_radius), lo: T('cell.aa_diameter_max').value}));
  add('parts', 'cell.aa_length_max', {target: 'cell.aa_length_max', unit: 'mm', parts: ['BAT-010', 'BAT-011', 'BAT-020', 'BAT-021'], note: 'Free length from the positive terminal to the conical spring\'s tip. It must be shorter than the shortest cell (49.2), so that every cell presses the spring, and long enough that the longest cell (50.5) compresses the spring by no more than half its height.'},
    () => { const free = bat().positive_face - Math.max(...bat().spring_tips), height = Math.min(...bat().spring_tips.map((t, i) => t - bat().spring_bases[i]));
      return {value: free, lo: T('cell.aa_length_max').value - height / 2, hi: 49.2}; });
  add('motion', 'tape.runs_within_roller_capstan_head_and_guide', {unit: 'mm', cls: 'standard', variant: 'original', parts: ['MEDIA-004', 'BAY-061', 'BAY-052', 'BAY-060', 'HDC-040'], note: 'Least overlap, at either edge of the 3.81 mm tape, of the pinch roller, the capstan, the head face and the tape guide: the tape must lie wholly on each.'},
    () => { const tp = g.tape_path, t = tp['MEDIA-004']; return {value: Math.min(...['BAY-061', 'BAY-052', 'BAY-060', 'HDC-040'].map(p => Math.min(t[0] - tp[p][0], tp[p][1] - t[1]))), lo: 0.05}; });
  // Round parts and shafts, from their outlines by height (g.profiles: [height, least radius, greatest radius] about the part's axis, at rest).
  const prof = id => g.profiles[id], span = lv => lv[lv.length - 1][0] - lv[0][0];
  direct('parts', 'tyre.fr_pulley.id', 'tyre.fr_pulley.id', () => 2 * Math.min(...prof('DRV-023').map(l => l[1])), {tol: 0.1, note: 'Bore of the FF/REW tyre. No tolerance is given; 0.1 mm is allowed for modelling.'});
  direct('parts', 'tyre.fr_pulley.width', 'tyre.fr_pulley.width', () => span(prof('DRV-023')), {tol: 0.05, note: 'Width of the FF/REW tyre along its axis. No tolerance is given; 0.05 mm is allowed for modelling.'});
  direct('motion', 'contact.fr_pulley_travel', 'contact.fr_pulley_travel', () => dist(g.modes.play.parts['DRV-023'].centre_xz, cap()) - dist(g.modes.ff.parts['DRV-023'].centre_xz, cap()),
    {note: 'How much nearer the capstan axis the FF/REW tyre stands in FF than in PLAY.'});
  const shaftRadius = id => { const lv = prof(id), top = Math.max(...lv.filter(l => l[2] > 1.2).map(l => l[0])); return Math.max(...lv.filter(l => l[0] > top && l[2] < 1.2).map(l => l[2])); };
  add('parts', 'shaft.pulleys_third_gear', {target: 'shaft.pulleys_third_gear', unit: 'mm', parts: ['DRV-106', 'DRV-107', 'CAM-101'], note: 'Diameter of the shafts of the middle pulley, the FF/REW pulley and the third gear above their flanges; the one furthest from 1.6 mm is shown. No tolerance is given; 0.02 mm is allowed for modelling.'},
    () => { const d = ['DRV-106', 'DRV-107', 'CAM-101'].map(id => 2 * shaftRadius(id)).sort((a, b) => Math.abs(b - 1.6) - Math.abs(a - 1.6)); return {value: d[0], target: T('shaft.pulleys_third_gear').value, tol: 0.02}; });
  add('parts', 'shaft.levers', {target: 'shaft.levers', unit: 'mm', parts: ['STP-010', 'STP-011', 'RLC-030'], note: 'Diameter of the STOP lever\'s two guide spindles and release lever C\'s post above its foot; the one furthest from 2 mm is shown. The head board\'s posts are not identified in the model. No tolerance is given; 0.02 mm is allowed for modelling.'},
    () => { const d = ['STP-010', 'STP-011', 'RLC-030'].map(id => 2 * shaftRadius(id)).sort((a, b) => Math.abs(b - 2) - Math.abs(a - 2)); return {value: d[0], target: T('shaft.levers').value, tol: 0.02}; });
  add('parts', 'shaft.fr_gears', {target: 'shaft.fr_gears', unit: 'mm', parts: ['DRV-202', 'DRV-213', 'DRV-205'], note: 'Bore of the 1.2 mm plastic washers that hold FF/REW gears A and B and the secondary gear on their shafts, seated in a neck at the shaft\'s top; the one furthest from 1.2 mm is shown. No tolerance is given; 0.02 mm is allowed for modelling.'},
    () => { const d = ['DRV-202', 'DRV-213', 'DRV-205'].map(id => 2 * Math.min(...prof(id).map(l => l[1]))).sort((a, b) => Math.abs(b - 1.2) - Math.abs(a - 1.2)); return {value: d[0], target: T('shaft.fr_gears').value, tol: 0.02}; });
  direct('motion', 'gear.module', 'gear.module', () => 2 * dist(xz(pv.supply_reel), xz(pv.s_gear_b)) / (g.gears['DRV-010'][0].teeth + g.gears['DRV-011'][0].teeth),
    {tol: 0.005, parts: ['DRV-010', 'DRV-011'], note: 'From the centre distance of S gears A and B and their tooth counts. No tolerance is given; 0.005 mm is allowed (the photographs give 0.302).'});
  // The flywheel by height, from the front: main disc (the FF/REW tyre's track), belt groove, upper flange, small pulley, hub flange.
  const flyProfile = () => { const lv = prof('MEC-011'), R = Math.max(...lv.map(l => l[2])), disc = lv.filter(l => l[2] > R - 0.75), discEnd = Math.max(...disc.map(l => l[0]));
    const after = lv.filter(l => l[0] > discEnd), F = Math.max(...after.map(l => l[2])), flange = after.filter(l => l[2] > F - 0.15), flangeEnd = Math.max(...flange.map(l => l[0]));
    return {disc: discEnd - Math.min(...disc.map(l => l[0])), groove: Math.min(...flange.map(l => l[0])) - discEnd, flange: flangeEnd - Math.min(...flange.map(l => l[0])), flangeDia: 2 * F,
      hubDia: 2 * Math.max(...lv.filter(l => l[0] > flangeEnd + 0.5).map(l => l[2]))}; };
  direct('parts', 'flywheel.main_disc_thickness', 'flywheel.main_disc_thickness', () => flyProfile().disc, {parts: ['MEC-011'], note: 'Along the axis, over the heights where the flywheel is within 0.75 mm of its full radius.'});
  direct('parts', 'flywheel.groove_width', 'flywheel.groove_width', () => flyProfile().groove, {parts: ['MEC-011'], note: 'From the main disc\'s back to the upper flange\'s front. Kept narrow in the model to stay under the thrust bridge as modelled.'});
  direct('parts', 'flywheel.upper_flange_thickness', 'flywheel.upper_flange_thickness', () => flyProfile().flange, {parts: ['MEC-011']});
  direct('parts', 'flywheel.upper_flange_diameter', 'flywheel.upper_flange_diameter', () => flyProfile().flangeDia, {parts: ['MEC-011']});
  direct('parts', 'flywheel.hub_flange_diameter', 'flywheel.hub_flange_diameter', () => flyProfile().hubDia, {parts: ['MEC-011'], note: 'The flange on top of the small pulley for the second belt.'});
  // Tooth counts, taken from the gears' own outlines: the outer ring, or the second ring of a two-ring gear.
  for (const [id, part, k] of [['gear.takeup.teeth', 'DRV-014', 0], ['gear.takeup.step_teeth', 'DRV-014', 1], ['gear.s_gear_a.teeth', 'DRV-010', 0], ['gear.s_gear_b.teeth', 'DRV-011', 0],
    ['gear.fr_gear_b.teeth', 'DRV-013', 0], ['gear.fr_pulley_pinion.teeth', 'DRV-021', 0], ['gear.fr_gear_a.teeth', 'DRV-012', 0], ['gear.fr_gear_a_small_tier.teeth', 'DRV-012', 1], ['gear.third.teeth', 'CAM-010', 0],
    ['gear.secondary.teeth', 'DRV-016', 0], ['gear.secondary_pinion.teeth', 'DRV-016', 1], ['gear.third_pinion.teeth', 'CAM-010', 1]])
    direct('motion', 'teeth.' + id.slice(5, -6), id, () => g.gears[part][k].teeth, {unit: 'teeth', parts: [part], note: 'Counted on the model\'s own outline: the ' + (k ? 'second' : 'outer') + ' ring of teeth.'});
  direct('motion', 'ratio.reverse_wheel_to_flywheel', 'ratio.reverse_wheel_to_flywheel', () => Math.abs(run('belt return guide').factor));
  for (const [id, name, gear, parts] of [['gear.s_gear_b_ratio', 'supply intermediate', 'gear.s_gear_b.teeth', ['DRV-011', 'DRV-010']]])
    add('motion', id, {uses: ['gear.s_gear_a.teeth', gear], cls: 'photo-measured', parts}, () => {
      const a = T('gear.s_gear_a.teeth').value, z = T(gear).value, want = a / z;
      return {value: Math.abs(run(name).factor), target: want, tol: want * 0.001, note: 'Speed against S gear A; tooth ratio ' + a + '/' + z + '. Motion rig: ' + run(name).expression};
    });
  // Gears in mesh move tooth for tooth: speed times teeth is the same on both. FR gear A's 26 teeth meet FR gear B and, in FF, the clutch
  // gear's 60; its 15 teeth meet S gear B in REW. The speeds are per turn of the reel that the train ends at.
  add('motion', 'gear.fr_train_moves_tooth_for_tooth', {uses: ['gear.fr_pulley_pinion.teeth', 'gear.fr_gear_a.teeth', 'gear.fr_gear_a_small_tier.teeth', 'gear.fr_gear_b.teeth', 'gear.s_gear_b.teeth', 'gear.takeup.teeth'], unit: '%', cls: 'photo-measured', parts: ['DRV-021', 'DRV-012', 'DRV-013', 'DRV-011', 'DRV-014'],
    note: 'Largest mismatch of tooth speed among the gears in mesh: the FR pulley with FR gear B and FR gear B with FR gear A in FF and REW, FR gear A with the clutch gear in FF, FR gear A with S gear B in REW.'}, () => {
    const z = id => T(id).value, w = (name, mode) => Math.abs(run(name).by_mode[mode]), pairs = [
      [w('FR pulley and tyre', 'ff') * z('gear.fr_pulley_pinion.teeth'), w('FR gear B', 'ff') * z('gear.fr_gear_b.teeth')], [w('FR pulley and tyre', 'rew') * z('gear.fr_pulley_pinion.teeth'), w('FR gear B', 'rew') * z('gear.fr_gear_b.teeth')],
      [w('FR gear B', 'ff') * z('gear.fr_gear_b.teeth'), w('FR gear A', 'ff') * z('gear.fr_gear_a.teeth')], [w('FR gear B', 'rew') * z('gear.fr_gear_b.teeth'), w('FR gear A', 'rew') * z('gear.fr_gear_a.teeth')],
      [w('FR gear A', 'ff') * z('gear.fr_gear_a.teeth'), w('take-up clutch', 'ff') * z('gear.takeup.teeth')], [w('FR gear A', 'rew') * z('gear.fr_gear_a_small_tier.teeth'), w('supply intermediate', 'rew') * z('gear.s_gear_b.teeth')]];
    return {value: Math.max(...pairs.map(([a, b]) => a && b ? Math.abs(a / b - 1) * 100 : 100)), lo: 0, hi: 0.1};
  });
  for (const [id, mode, other, teeth, note] of [['gear.fr_gear_a_meets_clutch_gear_in_ff', 'ff', () => tu(), ['gear.fr_gear_a.teeth', 'gear.takeup.teeth'], 'the clutch gear in FF'],
    ['gear.fr_gear_a_meets_s_gear_b_in_rew', 'rew', () => xz(pv.s_gear_b), ['gear.fr_gear_a_small_tier.teeth', 'gear.s_gear_b.teeth'], 'S gear B in REW']])
    add('motion', id, {uses: ['gear.module', ...teeth], unit: 'mm', cls: 'designed', parts: ['DRV-012'], note: 'Distance from FR gear A to ' + note + ', against the distance at which their teeth mesh.'},
      () => ({value: dist(centre(mode, 'DRV-012'), other()), target: T('gear.module').value * (T(teeth[0]).value + T(teeth[1]).value) / 2, tol: 0.05}));
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
