import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {acquireBuildLock} from '../tools/build-lock.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ptp-lock-'));
const moduleUrl = new URL('../tools/build-lock.mjs', import.meta.url).href;
const source = `import {acquireBuildLock} from ${JSON.stringify(moduleUrl)};
  try { const lock=await acquireBuildLock(process.argv[1]); console.log('acquired'); process.stdin.resume(); process.stdin.once('end',async()=>{await lock.release();}); }
  catch(error) { console.error(error.message); process.exitCode=1; }`;
const children = [];
function launch() {
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, root], {stdio: ['pipe', 'pipe', 'pipe']});
  children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
  return {child, output: () => ({stdout, stderr}), closed: once(child, 'close')};
}
try {
  const first = launch();
  await new Promise((resolve, reject) => { first.child.stdout.once('data', resolve); first.child.once('error', reject); });
  assert.equal(first.output().stdout.trim(), 'acquired');
  const second = launch();
  assert.equal((await second.closed)[0], 1);
  assert.match(second.output().stderr, /Build lock is (alive|indeterminate)/);
  assert.match(second.output().stderr, /confirm their Blender children have exited/);
  assert.match(second.output().stderr, /process started/);
  assert(second.output().stderr.includes(process.platform === 'win32' ? 'Remove-Item -LiteralPath' : 'rm -rf --'));
  const owner = JSON.parse(await fs.readFile(path.join(root, '.ptp-build.lock/owner.json'), 'utf8'));
  assert.equal(owner.pid, first.child.pid); assert(Number.isFinite(Date.parse(owner.startedAt))); assert(owner.token);
  first.child.stdin.end(); assert.equal((await first.closed)[0], 0);

  const lock = await acquireBuildLock(root);
  await lock.release(); await lock.release();

  const killed = launch(); await once(killed.child.stdout, 'data');
  killed.child.kill('SIGKILL'); await killed.closed;
  await assert.rejects(acquireBuildLock(root), error => error.state === 'stale' && error.lockPath === path.join(root, '.ptp-build.lock'));
  assert.equal(JSON.parse(await fs.readFile(path.join(root, '.ptp-build.lock/owner.json'), 'utf8')).pid, killed.child.pid, 'stale lock is not stolen');
  // The test is now quiescent and explicitly performs the documented maintenance removal.
  await fs.rm(path.join(root, '.ptp-build.lock'), {recursive: true});
  await fs.mkdir(path.join(root, '.ptp-build.lock'));
  await fs.writeFile(path.join(root, '.ptp-build.lock/owner.json'), '{broken');
  await assert.rejects(acquireBuildLock(root), error => error.state === 'indeterminate');
  console.log('Build lock: concurrent ownership, release, killed owner and malformed metadata pass without takeover.');
} finally {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await fs.rm(root, {recursive: true, force: true});
}
