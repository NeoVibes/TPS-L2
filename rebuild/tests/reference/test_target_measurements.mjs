// The measurements behind the target checks, on the shipped model: every check must measure the same
// number that is on record for the shipped model.
import '../test_setup.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {VIEW} from '../../tools/integrity.mjs';

const before = JSON.parse(readFileSync(new URL('./target-checks.json', import.meta.url), 'utf8')).checks;
const now = Object.fromEntries(JSON.parse(readFileSync(path.join(VIEW, 'assessment-results.json'), 'utf8')).checks.map(c => [c.id, c]));
for (const [id, was] of Object.entries(before)) {
  assert(now[id], id + ': the check is gone');
  if (typeof was.value === 'number') assert(Math.abs(now[id].value - was.value) <= 1.5e-4, id + ': measured ' + now[id].value + ', was ' + was.value);
  else assert.equal(now[id].value, was.value, id);
}
console.log('Target checks:', Object.keys(before).length, 'measurements equal those of the shipped model');
