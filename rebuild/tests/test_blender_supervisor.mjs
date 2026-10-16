import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runManagedBlender} from '../tools/managed-blender.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ptp-supervisor-'));
const moduleUrl = new URL('../tools/managed-blender.mjs', import.meta.url).href;
const lockUrl = new URL('../tools/build-lock.mjs', import.meta.url).href;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(check, label, timeout = 10000) {
  const started = Date.now();
  while (!await check()) { if (Date.now() - started > timeout) throw Error('Timed out: ' + label); await pause(25); }
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
const parents = [], stagePids = [];

async function parentDeath(name, executable, args, readyText, {env = {}, readyCheck = async () => true} = {}) {
  const directory = path.join(root, name); await fs.mkdir(directory);
  const pidFile = path.join(directory, 'child.pid');
  const program = `import {runManagedBlender} from ${JSON.stringify(moduleUrl)};
    import {acquireBuildLock} from ${JSON.stringify(lockUrl)};
    import {writeFileSync} from 'node:fs';
    const lock=await acquireBuildLock(${JSON.stringify(directory)});
    await runManagedBlender({executable:${JSON.stringify(executable)},args:${JSON.stringify(args)},cwd:${JSON.stringify(directory)},env:{...process.env,...${JSON.stringify(env)}},graceMs:100,
      onSpawn:pid=>writeFileSync(${JSON.stringify(pidFile)},String(pid)),onStdout:data=>process.stdout.write(data),onStderr:data=>process.stderr.write(data)});
    await lock.release();`;
  const parent = spawn(process.execPath, ['--input-type=module', '-e', program], {stdio: ['ignore', 'pipe', 'pipe']});
  parents.push(parent);
  let output = '', errors = '';
  parent.stdout.on('data', data => output += data); parent.stderr.on('data', data => errors += data);
  const closed = once(parent, 'close');
  await until(async () => {
    if (parent.exitCode !== null || parent.signalCode !== null) throw Error('Parent exited before ready: ' + output + errors);
    return output.includes(readyText) && await readyCheck();
  }, name + ' readiness', 30000);
  const pid = Number(await fs.readFile(pidFile, 'utf8')); stagePids.push(pid);
  parent.kill('SIGKILL'); await closed;
  await until(() => !alive(pid), name + ' child reaped');
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, '.ptp-build.lock/owner.json'), 'utf8')).pid, parent.pid, 'parent death preserves the lock for maintenance');
  return {directory, pid, output};
}

try {
  let stdout = '', stderr = '';
  const success = await runManagedBlender({executable: process.execPath, args: ['-e', 'console.log("out");console.error("err");'], onStdout: data => stdout += data, onStderr: data => stderr += data});
  assert.equal(success.code, 0); assert.equal(success.cancelled, false); assert.match(stdout, /out/); assert.match(stderr, /err/);
  assert.equal((await runManagedBlender({executable: process.execPath, args: ['-e', 'process.exit(7)']})).code, 7);
  await assert.rejects(runManagedBlender({executable: path.join(root, 'no-such-blender')}), /Could not start managed Blender/);
  const beforeStart = new AbortController(); beforeStart.abort();
  assert.equal((await runManagedBlender({executable: process.execPath, signal: beforeStart.signal})).cancelled, true);

  const controller = new AbortController();
  const cancelled = await runManagedBlender({executable: process.execPath,
    args: ['-e', 'process.on("SIGTERM",()=>{});console.log("ready");setInterval(()=>{},100);'],
    signal: controller.signal, graceMs: 50, onStdout: data => { if (data.toString().includes('ready')) controller.abort(); }});
  assert.equal(cancelled.cancelled, true);
  if (process.platform !== 'win32') assert.equal(cancelled.signal, 'SIGKILL', 'unresponsive stage is escalated');
  assert(!alive(cancelled.pid));

  let orphanPid;
  await assert.rejects(runManagedBlender({executable: process.execPath,
    args: ['-e', 'console.log(JSON.stringify({parent:process.ppid,pid:process.pid}));setInterval(()=>{},100);'],
    onStdout: data => { const child = JSON.parse(data.toString()); orphanPid = child.pid; stagePids.push(child.pid); process.kill(child.parent, 'SIGKILL'); }}),
    /supervisor ended unexpectedly/);
  // An orphan may remain as an OS zombie until adopted/reaped; in that case the helper
  // conservatively asks the caller to retain the lock instead of claiming termination.
  if (alive(orphanPid)) await until(() => !alive(orphanPid), 'orphan reaping', 10000);

  await parentDeath('node-child', process.execPath, ['-e', 'console.log("stage ready");setInterval(()=>{},100);'], 'stage ready');
  if (process.env.PTP_TEST_BLENDER) {
    const {ROOT, VIEW, modelInputs, json, hash, walk} = await import('../tools/integrity.mjs');
    const snapshotView = async () => Object.fromEntries(await Promise.all((await walk('../view')).map(async file =>
      [path.relative(VIEW, path.resolve(ROOT, file)), hash(await fs.readFile(path.resolve(ROOT, file)))])));
    const beforeView = await snapshotView(), inputs = await modelInputs(), config = await json('config/model.json');
    const staging = path.join(root, 'native-export-staging'); await fs.mkdir(staging);
    const result = await parentDeath('real-blender-export', process.env.PTP_TEST_BLENDER,
      ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '2', '--python', path.join(ROOT, 'tools/export_model.py')], 'GEOMETRY 0',
      {env: {PTP_STAGE_OUT: staging, PTP_EXPECTED_NATIVE_SHA256: inputs[config.native], PYTHONDONTWRITEBYTECODE: '1'},
        readyCheck: async () => fs.access(path.join(staging, 'inventory.json')).then(() => true, () => false)});
    assert(!result.output.includes('EXPORT PASS'), 'the real export was interrupted before completion');
    assert.equal(JSON.parse(await fs.readFile(path.join(staging, 'inventory.json'), 'utf8')).native_sha256, inputs[config.native]);
    assert.equal(await fs.access(path.join(staging, 'export-report.json')).then(() => true, () => false), false, 'completed export report must not be present');
    assert.equal(await fs.access(path.join(staging, 'receipt.json')).then(() => true, () => false), false, 'partial export must not be certified');
    assert.deepEqual(await snapshotView(), beforeView, 'actual live viewer contents must remain byte-for-byte unchanged');
    assert.equal((await modelInputs())[config.native], inputs[config.native], 'native Blender source remains unchanged');
    console.log('Real Blender export parent-death check passed: GEOMETRY 0 observed, bound inventory staged, child reaped, stale lock retained, incomplete staging uncertified, ' + Object.keys(beforeView).length + ' live viewer files unchanged.');
  }
  console.log('Managed Blender supervisor: output, exit status, startup failure, cancellation/escalation and parent-death reaping pass.');
} finally {
  for (const parent of parents) if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
  for (const pid of stagePids) if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  await fs.rm(root, {recursive: true, force: true});
}
