import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createDirectoryTransaction, cleanupLeftovers} from '../tools/build-transaction.mjs';
import {acquireBuildLock} from '../tools/build-lock.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ptp-transaction-'));
const exists = file => fs.lstat(file).then(() => true, () => false);
const put = async (folder, value) => { await fs.mkdir(folder, {recursive: true}); await fs.writeFile(path.join(folder, 'output'), value); };
const value = folder => fs.readFile(path.join(folder, 'output'), 'utf8');
const failure = message => Object.assign(Error(message), {code: 'EACCES'});
async function fixture(name, fsOps = fs, prior = true) {
  const folder = path.join(root, name); await fs.mkdir(folder);
  const live = path.join(folder, 'view'); if (prior) await put(live, 'old');
  const transaction = await createDirectoryTransaction(live, {fsOps});
  await put(transaction.stage, 'new');
  return transaction;
}

try {
  let transaction = await fixture('success');
  assert.deepEqual(await transaction.commit(), {committed: true, warnings: []});
  assert.equal(await value(transaction.live), 'new');
  assert(!await exists(transaction.backup));
  await assert.rejects(transaction.commit(), /already attempted/);

  transaction = await fixture('first-rename', {...fs, rename: async () => { throw failure('first rename denied'); }});
  await assert.rejects(transaction.commit(), error => error.unchanged === true && error.phase === 'before-commit' && /first rename denied/.test(error.message));
  assert.equal(await value(transaction.live), 'old');
  await transaction.discard(); assert(!await exists(transaction.stage));

  let renames = 0;
  transaction = await fixture('promotion', {...fs, rename: async (...args) => { if (++renames === 2) throw failure('promotion denied'); return fs.rename(...args); }});
  await assert.rejects(transaction.commit(), error => error.unchanged === true && /previous output is unchanged/.test(error.message));
  assert.equal(await value(transaction.live), 'old');
  assert.equal(renames, 3, 'failed promotion restores the backup');
  await transaction.discard(); assert(!await exists(transaction.stage)); assert(!await exists(transaction.backup));

  transaction = await fixture('cleanup', {...fs, rm: async () => { throw failure('backup busy'); }});
  const committed = await transaction.commit();
  assert.equal(committed.committed, true); assert.match(committed.warnings[0], /New output is committed.*backup cleanup failed/);
  assert.equal(committed.backup, transaction.backup);
  assert.equal(await value(transaction.live), 'new'); assert.equal(await value(transaction.backup), 'old');
  await transaction.discard(); assert.equal(await value(transaction.backup), 'old');

  renames = 0;
  transaction = await fixture('rollback', {...fs, rename: async (...args) => { if (++renames > 1) throw failure('rename busy'); return fs.rename(...args); }});
  await assert.rejects(transaction.commit(), error => error.unchanged === false && error.phase === 'rollback' && error.recoveryPaths.includes(transaction.backup));
  assert(!await exists(transaction.live)); assert.equal(await value(transaction.backup), 'old'); assert.equal(await value(transaction.stage), 'new');
  await transaction.discard(); assert.equal(await value(transaction.backup), 'old'); assert.equal(await value(transaction.stage), 'new');

  transaction = await fixture('first-build', fs, false);
  assert.equal((await transaction.commit()).committed, true); assert.equal(await value(transaction.live), 'new');
  transaction = await fixture('first-build-failure', {...fs, rename: async () => { throw failure('first build denied'); }}, false);
  await assert.rejects(transaction.commit(), error => error.unchanged === true);
  assert(!await exists(transaction.live)); await transaction.discard();

  transaction = await fixture('leftovers');
  await put(transaction.backup, 'old');
  const legacy = path.join(path.dirname(transaction.live), 'view.previous'); await put(legacy, 'legacy');
  const unrelated = path.join(path.dirname(transaction.live), '.view.staging-not-a-build-id'); await put(unrelated, 'keep');
  let verified = 0;
  const cleaned = await cleanupLeftovers(transaction.live, {verify: async live => { verified++; assert.equal(await value(live), 'old'); }});
  assert.equal(verified, 1); assert.equal(cleaned.removed.length, 3); assert.deepEqual(cleaned.warnings, []);
  assert.equal(await value(unrelated), 'keep'); assert.equal(await value(transaction.live), 'old');

  transaction = await fixture('invalid-live'); await put(transaction.backup, 'only valid old');
  await assert.rejects(cleanupLeftovers(transaction.live, {verify: async () => { throw Error('corrupt live'); }}), /Leftovers were preserved/);
  assert.equal(await value(transaction.backup), 'only valid old'); assert.equal(await value(transaction.stage), 'new');
  await fs.rm(transaction.live, {recursive: true});
  await assert.rejects(cleanupLeftovers(transaction.live, {verify: async () => { throw Error('must not run'); }}), /live directory is missing/);
  assert.equal(await value(transaction.backup), 'only valid old');
  assert.deepEqual(await cleanupLeftovers(path.join(root, 'absent-view'), {verify: async () => { throw Error('must not run'); }}), {removed: [], warnings: []});

  // Exercise a process exit as well as helper outcomes: cleanup warnings remain successful,
  // while a denied rename fails and retains the previous bytes.
  const moduleUrl = new URL('../tools/build-transaction.mjs', import.meta.url).href;
  for (const mode of ['rename', 'cleanup']) {
    const folder = path.join(root, 'status-' + mode); await fs.mkdir(folder); const live = path.join(folder, 'view'); await put(live, 'old');
    const script = `import * as fs from 'node:fs/promises'; import {createDirectoryTransaction} from ${JSON.stringify(moduleUrl)};
      const mode=process.argv[1], live=process.argv[2];
      const ops={...fs,...(mode==='rename'?{rename:async()=>{throw Error('rename denied')}}:{rm:async()=>{throw Error('cleanup denied')}})};
      const tx=await createDirectoryTransaction(live,{fsOps:ops}); await fs.writeFile(tx.stage+'/output','new');
      try { for(const warning of (await tx.commit()).warnings) console.error(warning); }
      catch(error) { console.error(error.message); process.exitCode=1; }`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script, mode, live], {encoding: 'utf8'});
    assert.equal(run.status, mode === 'rename' ? 1 : 0);
    assert.equal(await value(live), mode === 'rename' ? 'old' : 'new');
    assert.match(run.stderr, mode === 'rename' ? /rename denied/ : /New output is committed.*cleanup denied/);
  }

  // A killed process does not run catch/finally. Stop it after live -> backup has really
  // happened, before the promotion rename, then prove startup retains both remaining copies.
  const interruptedRoot = path.join(root, 'interrupted'); await fs.mkdir(interruptedRoot);
  const interruptedLive = path.join(interruptedRoot, 'view'); await put(interruptedLive, 'old');
  const lockUrl = new URL('../tools/build-lock.mjs', import.meta.url).href;
  const interruptedScript = `import * as fs from 'node:fs/promises'; import {createDirectoryTransaction} from ${JSON.stringify(moduleUrl)};
    import {acquireBuildLock} from ${JSON.stringify(lockUrl)};
    await acquireBuildLock(process.argv[1]); let renames=0;
    const tx=await createDirectoryTransaction(process.argv[1]+'/view',{fsOps:{...fs,rename:async(...args)=>{
      await fs.rename(...args); if(++renames===1) { process.stdin.resume(); console.log(JSON.stringify({stage:tx.stage,backup:tx.backup})); await new Promise(()=>{}); }
    }}}); await fs.writeFile(tx.stage+'/output','new'); await tx.commit();`;
  const interrupted = spawn(process.execPath, ['--input-type=module', '-e', interruptedScript, interruptedRoot], {stdio: ['pipe', 'pipe', 'pipe']});
  const interruptedClosed = once(interrupted, 'close'); let interruptedOutput = '', interruptedErrors = '';
  interrupted.stderr.on('data', data => interruptedErrors += data);
  let retained;
  try {
    retained = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Build did not reach the rename boundary: ' + interruptedErrors)), 10000);
      interrupted.stdout.on('data', data => { interruptedOutput += data; if (interruptedOutput.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(interruptedOutput.trim())); } });
      interrupted.once('error', error => { clearTimeout(timer); reject(error); });
      interrupted.once('close', () => { clearTimeout(timer); if (!interruptedOutput.includes('\n')) reject(Error('Build exited before interruption: ' + interruptedErrors)); });
    });
  } finally { interrupted.kill('SIGKILL'); await interruptedClosed; }
  assert(!await exists(interruptedLive));
  assert.equal(await value(retained.backup), 'old'); assert.equal(await value(retained.stage), 'new');
  await assert.rejects(acquireBuildLock(interruptedRoot), error => error.state === 'stale');
  await fs.rm(path.join(interruptedRoot, '.ptp-build.lock'), {recursive: true}); // explicit maintenance, after child death
  const maintenanceLock = await acquireBuildLock(interruptedRoot);
  try {
    await assert.rejects(cleanupLeftovers(interruptedLive, {verify: async () => { throw Error('must not run'); }}), /Leftovers were preserved/);
    assert.equal(await value(retained.backup), 'old'); assert.equal(await value(retained.stage), 'new');
  } finally { await maintenanceLock.release(); }

  if (process.platform === 'win32') {
    transaction = await fixture('windows-open-handle');
    const script = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public class DirectoryHandle {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern SafeFileHandle CreateFileW(string name, uint access, uint sharing, IntPtr security, uint creation, uint flags, IntPtr template);
}
'@
$handle = [DirectoryHandle]::CreateFileW($env:PTP_TEST_DIRECTORY, 0x80000000, 3, [IntPtr]::Zero, 3, 0x02000000, [IntPtr]::Zero)
if ($handle.IsInvalid) { throw 'Could not hold the live directory handle' }
try { [Console]::Out.WriteLine('held'); [Console]::In.ReadLine() | Out-Null } finally { $handle.Dispose() }`;
    const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      {env: {...process.env, PTP_TEST_DIRECTORY: transaction.live}, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
    const closed = once(holder, 'close'); let output = '', errors = '';
    holder.stdout.on('data', data => output += data); holder.stderr.on('data', data => errors += data);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Directory handle was not opened: ' + errors)), 10000);
        holder.stdout.on('data', () => { if (output.includes('held')) { clearTimeout(timer); resolve(); } });
        holder.once('error', error => { clearTimeout(timer); reject(error); });
        holder.once('close', () => { clearTimeout(timer); if (!output.includes('held')) reject(Error('Directory holder failed: ' + errors)); });
      });
      await assert.rejects(transaction.commit(), error => error.unchanged === true && error.phase === 'before-commit');
      assert.equal(await value(transaction.live), 'old');
      await transaction.discard();
    } finally { holder.stdin.end('\n'); await closed; }
  }
  console.log('Directory transactions: committed output, rename/rollback failures, cleanup warnings, actual process interruption and conservative leftover handling pass.');
} finally { await fs.rm(root, {recursive: true, force: true}); }
