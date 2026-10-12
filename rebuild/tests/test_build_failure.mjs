// A build that fails must leave the previous view/ exactly as it was, with nothing half-written.
import './test_setup.mjs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ROOT, KIT, VIEW} from '../tools/integrity.mjs';
import {viewFiles} from './kit_files.mjs';

const snapshot = () => Object.fromEntries(viewFiles().map(f => [f, createHash('sha256').update(readFileSync(path.join(VIEW, f))).digest('hex')]));
const before = snapshot();
// Rebuild only the page, and stop it on purpose after everything is staged but before the swap.
const run = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--viewer'], {cwd: ROOT, encoding: 'utf8', env: {...process.env, PTP_TEST_FAIL_BEFORE_SWAP: '1'}});
assert.equal(run.status, 1, 'the stopped build must report failure');
assert.match(run.stderr, /view\/ is unchanged/);
assert.deepEqual(snapshot(), before, 'view/ must be untouched after a failed build');
assert(!existsSync(path.join(KIT, 'view.staging')) && !existsSync(path.join(KIT, 'view.previous')), 'no staging folder may be left behind');
console.log('A failed build left view/ untouched:', Object.keys(before).length, 'files compared');
