// How confirmation levels are worked out (tools/confirmation.mjs), on a small made-up model.
// A part's level is its weakest required feature; an assessment counts only while it still holds.
import './test_setup.mjs';
import assert from 'node:assert/strict';
import {assess, assessmentProblems, bindingFor, conflicting, PLACEHOLDER} from '../tools/confirmation.mjs';
import {runChecks, targetProblems, targetOutcome, targetDefinition} from '../tools/targets.mjs';
import {describeChanges} from '../tools/compare.mjs';

const copy = v => JSON.parse(JSON.stringify(v));
const row = (part_id, variant = '') => ({status: 'modelled', row_id: variant ? part_id + '/' + variant : part_id, part_id, variant});
const rows = [row('SHAFT'), row('WHEEL'), row('TAPE', 'original'), row('TAPE', 'detailed'), {status: 'not modelled', row_id: 'manual/SVC-1', part_id: '', variant: ''}];
const print = n => ({shape: 's' + n, poses: 'p' + n, spin: 'r' + n, other: 'o' + n});
const fingerprints = {parts: {SHAFT: print(1), WHEEL: print(2), TAPE: print(3), 'cassette alternative TAPE': print(4)}};
const measured = {targets: {}, parts: {SHAFT: {size_mm: [2, 23, 2], longest_length_mm: 23.1}, WHEEL: {size_mm: [24, 5, 24], longest_length_mm: 24.2}, TAPE: {size_mm: [60, 4, 100], longest_length_mm: 117}},
  cassette_detailed: {TAPE: {size_mm: [63.8, 4, 100.4], longest_length_mm: 119}}};
const size = (id, part, along, value, tol, more = {}) => ({id, value, tol, unit: 'mm', class: 'measured', basis: 'issue', measure: {size_of: part, along}, ...more});
const targetFile = {classes: {measured: 'x'}, targets: [
  size('shaft.diameter', 'SHAFT', 'width', 2.0, 0.05), size('shaft.length', 'SHAFT', 'depth', 23.0, 0.2), size('shaft.length.second', 'SHAFT', 'depth', 23.1, 0.2),
  size('shaft.length.other', 'SHAFT', 'depth', 25.0, 0.2), size('wheel.diameter', 'WHEEL', 'width', 30.0, 0.5), size('wheel.reach', 'WHEEL', 'longest', 24.2, 0.1),
  size('tape.width', 'TAPE', 'height', 100.4, 0.3, {variant: 'detailed'}), {id: 'wheel.teeth', value: 40, tol: 0, class: 'measured', basis: 'issue'}]};
assert.deepEqual(targetProblems(targetFile, ['SHAFT', 'WHEEL', 'TAPE']), []);
const checks = runChecks(targetFile, measured);
const outcome = id => targetOutcome(checks, id).status;
assert.equal(outcome('shaft.diameter'), 'pass'); assert.equal(outcome('wheel.diameter'), 'fail'); assert.equal(outcome('wheel.reach'), 'pass'); assert.equal(outcome('wheel.teeth'), 'no check');
assert.equal(targetOutcome(checks, 'tape.width', 'detailed').status, 'pass'); assert.equal(targetOutcome(checks, 'tape.width', 'original').status, 'no check', 'a check on one cassette variant says nothing about the other');

const state = {targetFile, checks, fingerprints};
const made = (id, part, feature, level, target, issues, variant) => { const a = {id, part, feature, level, issues}; if (target) a.target = target; if (variant) a.variant = variant; a.bound_to = bindingFor(a, state); return a; };
const levelsOf = (file, prints = fingerprints, files = targetFile, list = checks) => assess({rows, file, targetFile: files, checks: list, fingerprints: prints});
const feature = (result, rowId, name) => result.get(rowId).features.find(f => f.name === name);

// Nothing assessed: every modelled row is level 1 on the placeholder, an unmodelled entry is level 0.
let result = levelsOf({checklists: {}, assessments: []});
assert.equal(result.get('SHAFT').level, 1); assert.equal(result.get('SHAFT').features[0].name, PLACEHOLDER); assert.equal(result.get('manual/SVC-1').level, 0);

// A measurement without a reviewed checklist is recorded but does not raise the part: the placeholder is still unassessed.
const diameter = made('A-1', 'SHAFT', 'diameter', 4, 'shaft.diameter', [11]);
result = levelsOf({checklists: {}, assessments: [diameter]});
assert.equal(feature(result, 'SHAFT', 'diameter').level, 4); assert.equal(feature(result, 'SHAFT', 'diameter').required, false); assert.equal(result.get('SHAFT').level, 1);

// With a checklist, the part takes its lowest feature; a feature nobody assessed counts as level 1.
const checklists = {SHAFT: {features: ['diameter', 'length'], reviewed: 'issue 11'}};
result = levelsOf({checklists, assessments: [diameter]});
assert.equal(result.get('SHAFT').level, 1); assert.equal(result.get('SHAFT').confirmed, 1); assert.equal(result.get('SHAFT').required, 2);
const length = made('A-2', 'SHAFT', 'length', 5, 'shaft.length', [12]);
result = levelsOf({checklists, assessments: [diameter, length]});
assert.equal(result.get('SHAFT').level, 4, 'lowest of 4 and 5');

// A failed check, a target with no check, and an assessment not yet accepted all leave the feature at level 1, with the reason.
const wheel = {WHEEL: {features: ['diameter'], reviewed: 'maintainer'}};
result = levelsOf({checklists: wheel, assessments: [made('A-3', 'WHEEL', 'diameter', 4, 'wheel.diameter', [13])]});
assert.equal(result.get('WHEEL').level, 1); assert.match(feature(result, 'WHEEL', 'diameter').why.join(' '), /does not match wheel\.diameter.*gives 24/);
result = levelsOf({checklists: {WHEEL: {features: ['teeth'], reviewed: 'maintainer'}}, assessments: [made('A-4', 'WHEEL', 'teeth', 4, 'wheel.teeth', [14])]});
assert.equal(result.get('WHEEL').level, 1); assert.match(feature(result, 'WHEEL', 'teeth').why.join(' '), /has no check/);
const waiting = copy(diameter); delete waiting.bound_to;
result = levelsOf({checklists: {SHAFT: {features: ['diameter'], reviewed: 'maintainer'}}, assessments: [waiting]});
assert.equal(result.get('SHAFT').level, 1); assert.match(feature(result, 'SHAFT', 'diameter').why.join(' '), /not yet accepted/);
// The accepted measurement is kept when the model disagrees: the record is untouched, only the level drops.
assert.equal(made('A-3', 'WHEEL', 'diameter', 4, 'wheel.diameter', [13]).bound_to.target, targetDefinition(targetFile.targets[4]));

// Fingerprints: a change of shape, position or motion means reassessment; a change of name or grouping does not.
const one = {checklists: {SHAFT: {features: ['diameter'], reviewed: 'maintainer'}}, assessments: [diameter]};
assert.equal(levelsOf(one).get('SHAFT').level, 4);
for (const key of ['shape', 'poses', 'spin']) {
  const changed = copy(fingerprints); changed.parts.SHAFT[key] = 'edited';
  result = levelsOf(one, changed);
  assert.equal(result.get('SHAFT').level, 1, key); assert.match(feature(result, 'SHAFT', 'diameter').why.join(' '), /since this was accepted/);
}
const renamed = copy(fingerprints); renamed.parts.SHAFT.other = 'renamed';
assert.equal(levelsOf(one, renamed).get('SHAFT').level, 4, 'a name or grouping change does not invalidate');
const removed = copy(fingerprints); delete removed.parts.SHAFT;
assert.match(feature(levelsOf(one, removed), 'SHAFT', 'diameter').why.join(' '), /no longer in the model/);
// A redefined target means reassessment, even if the model still passes; a reworded basis does not.
const redefined = copy(targetFile); redefined.targets[0].tol = 0.1;
assert.equal(levelsOf(one, fingerprints, redefined, runChecks(redefined, measured)).get('SHAFT').level, 1);
const reworded = copy(targetFile); reworded.targets[0].basis = 'said differently';
assert.equal(levelsOf(one, fingerprints, reworded, runChecks(reworded, measured)).get('SHAFT').level, 4);
// A relation between parts is tied to both of them.
const relation = copy(targetFile); relation.targets[0].parts = ['SHAFT', 'WHEEL'];
assert.deepEqual(Object.keys(bindingFor({id: 'A-9', part: 'SHAFT', feature: 'diameter', level: 4, target: 'shaft.diameter', issues: [1]}, {...state, targetFile: relation}).parts), ['SHAFT', 'WHEEL']);

// Conflicting measurements of one feature stay separate and neither counts; agreeing ones both count.
const second = made('A-5', 'SHAFT', 'length', 5, 'shaft.length.second', [15]), other = made('A-6', 'SHAFT', 'length', 4, 'shaft.length.other', [16]);
const lengthOnly = {SHAFT: {features: ['length'], reviewed: 'maintainer'}};
assert.equal(conflicting(targetFile.targets[1], targetFile.targets[3]), true); assert.equal(conflicting(targetFile.targets[1], targetFile.targets[2]), false);
result = levelsOf({checklists: lengthOnly, assessments: [length, other]});
assert.equal(result.get('SHAFT').level, 1); assert.match(feature(result, 'SHAFT', 'length').why.join(' '), /conflicts with A-6/);
assert.equal(levelsOf({checklists: lengthOnly, assessments: [length, second]}).get('SHAFT').level, 5);

// Level 6: two level-5 assessments that hold, from different submissions, AND a maintainer's verification of two people and two units.
const pair = {checklists: lengthOnly, assessments: [length, second]};
assert.equal(levelsOf({...pair, corroborations: [{assessments: ['A-2', 'A-5']}]}).get('SHAFT').level, 5, 'two issue numbers alone are not enough');
assert.equal(levelsOf({...pair, corroborations: [{assessments: ['A-2', 'A-5'], distinct_people_and_units_verified: true}]}).get('SHAFT').level, 6);
const sameIssue = copy(second); sameIssue.issues = [12];
assert.equal(levelsOf({checklists: lengthOnly, assessments: [length, sameIssue], corroborations: [{assessments: ['A-2', 'A-5'], distinct_people_and_units_verified: true}]}).get('SHAFT').level, 5, 'one submission cannot corroborate itself');
const weaker = copy(second); weaker.level = 4;
assert.equal(levelsOf({checklists: lengthOnly, assessments: [length, weaker], corroborations: [{assessments: ['A-2', 'A-5'], distinct_people_and_units_verified: true}]}).get('SHAFT').level, 5, 'both must be level 5');
const stale = copy(fingerprints); stale.parts.SHAFT.shape = 'edited';
assert.equal(levelsOf({...pair, corroborations: [{assessments: ['A-2', 'A-5'], distinct_people_and_units_verified: true}]}, stale).get('SHAFT').level, 1, 'and both must still hold');

// The two cassettes share part IDs and are assessed separately.
const tape = {checklists: {'TAPE/detailed': {features: ['width'], reviewed: 'maintainer'}, 'TAPE/original': {features: ['width'], reviewed: 'maintainer'}},
  assessments: [made('A-7', 'TAPE', 'width', 4, 'tape.width', [17], 'detailed')]};
result = levelsOf(tape);
assert.equal(result.get('TAPE/detailed').level, 4); assert.equal(result.get('TAPE/original').level, 1);
assert.deepEqual(Object.keys(tape.assessments[0].bound_to.parts), ['cassette alternative TAPE']);
const originalEdited = copy(fingerprints); originalEdited.parts.TAPE.shape = 'edited';
assert.equal(levelsOf(tape, originalEdited).get('TAPE/detailed').level, 4, 'editing the original cassette does not disturb the detailed one');

// A part whose lettering differs between exterior versions is assessed per state, like the cassettes.
const lidRows = [row('LID', 'later'), row('LID', 'intermediate+early')];
const lidPrints = {parts: {LID: print(5), 'exterior intermediate+early LID': print(6)}};
const lidState = {targetFile, checks, fingerprints: lidPrints};
const early = {id: 'A-8', part: 'LID', variant: 'intermediate+early', feature: 'lettering position', level: 2, issues: [18]}; early.bound_to = bindingFor(early, lidState);
const later = {id: 'A-9', part: 'LID', variant: 'later', feature: 'lettering position', level: 2, issues: [19]}; later.bound_to = bindingFor(later, lidState);
assert.deepEqual(Object.keys(early.bound_to.parts), ['exterior intermediate+early LID']); assert.deepEqual(Object.keys(later.bound_to.parts), ['LID'], 'the default state is stored under the part\'s own ID');
const lidFile = {checklists: {'LID/later': {features: ['lettering position'], reviewed: 'maintainer'}, 'LID/intermediate+early': {features: ['lettering position'], reviewed: 'maintainer'}}, assessments: [early]};
let lid = assess({rows: lidRows, file: lidFile, targetFile, checks, fingerprints: lidPrints});
assert.equal(lid.get('LID/intermediate+early').level, 2); assert.equal(lid.get('LID/later').level, 1, 'one state\'s confirmation says nothing about the other');
const lidEdited = copy(lidPrints); lidEdited.parts.LID.shape = 'edited';
assert.equal(assess({rows: lidRows, file: lidFile, targetFile, checks, fingerprints: lidEdited}).get('LID/intermediate+early').level, 2, 'editing the later lettering does not disturb the early state');
assert.match(assessmentProblems({checklists: {}, assessments: [{id: 'A-1', part: 'LID', feature: 'x', level: 2, issues: [1]}], corroborations: []}, lidRows, targetFile).join(' | '), /needs "variant": "later" or "intermediate\+early"/);

// The file is checked before it is used.
const problems = file => assessmentProblems({checklists: {}, assessments: [], corroborations: [], ...file}, rows, targetFile).join(' | ');
assert.match(problems({assessments: [{id: 'A-1', part: 'SHAFT', feature: 'diameter', level: 4, issues: [1]}]}), /need a "target"/);
assert.match(problems({assessments: [{id: 'A-1', part: 'SHAFT', feature: 'diameter', level: 6, target: 'shaft.diameter', issues: [1]}]}), /must be 2, 3, 4 or 5/);
assert.match(problems({assessments: [{id: 'A-1', part: 'SHAFT', feature: 'diameter', level: 4, target: 'shaft.diameter', issues: [1], measured_by: 'a name'}]}), /unknown field measured_by/);
assert.match(problems({assessments: [{id: 'A-1', part: 'TAPE', feature: 'width', level: 4, target: 'tape.width', issues: [1]}]}), /variant/);
assert.match(problems({assessments: [{id: 'A-1', part: 'SHAFT', feature: 'diameter', level: 4, target: 'shaft.diameter', issues: []}]}), /issue numbers/);
assert.match(problems({checklists: {SHAFT: {features: [PLACEHOLDER], reviewed: 'x'}}}), /placeholder/);
assert.match(problems({checklists: {SHAFT: {features: ['diameter']}}}), /reviewed/);
assert.match(problems({assessments: [diameter, length], corroborations: [{assessments: ['A-1', 'A-2'], distinct_people_and_units_verified: true}]}), /same feature/);
assert.equal(problems({checklists, assessments: [diameter, length]}), '');
assert.match(targetProblems({classes: {}, targets: [{id: 'x', value: 1}]}).join(' | '), /unknown class.*basis/);

// Dropping a hard feature from a checklist, or a level changing, shows up in the change report and must be accepted.
const fp = confirmation => ({parts: {}, settings: '', controls: '', confirmation});
assert.deepEqual(describeChanges(fp({SHAFT: {level: 1, required: ['diameter', 'length']}}), fp({SHAFT: {level: 4, required: ['diameter']}})),
  ['SHAFT: confirmation level 1 → 4', 'SHAFT: required features changed (no longer required: length)']);
assert.deepEqual(describeChanges(fp({}), fp({})), []);
console.log('Confirmation levels: aggregation, missing and failed checks, fingerprints, conflicts, level 6 and cassette variants behave as specified');
