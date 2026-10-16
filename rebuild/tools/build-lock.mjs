// One exclusive lock per kit. There is deliberately no automatic stale-lock takeover.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  const probe = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Process -Id ' + pid + ' -ErrorAction Stop).StartTime.ToUniversalTime().ToString("o")'], {encoding: 'utf8', timeout: 3000, windowsHide: true})
    : spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], {encoding: 'utf8', timeout: 3000, env: {...process.env, LC_ALL: 'C'}});
  return !probe.error && probe.status === 0 ? probe.stdout.trim() || null : null;
}

function ownerState(owner) {
  if (!owner || owner.host !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1) return 'indeterminate';
  try { process.kill(owner.pid, 0); }
  catch (error) { return error.code === 'ESRCH' ? 'stale' : 'indeterminate'; }
  const current = processIdentity(owner.pid);
  if (!current || !owner.processStarted) return 'indeterminate';
  return current === owner.processStarted ? 'alive' : 'stale';
}

export class BuildLockError extends Error {
  constructor(lockPath, state, owner) {
    const detail = owner ? ' PID ' + owner.pid + ' on ' + owner.host + ', process started ' + (owner.startedAt || owner.processStarted || 'unknown') + ', lock acquired ' + owner.acquiredAt + '.' : '';
    const maintenance = process.platform === 'win32'
      ? "Remove-Item -LiteralPath '" + lockPath.replaceAll("'", "''") + "' -Recurse -Force"
      : "rm -rf -- '" + lockPath.replaceAll("'", "'\\''") + "'";
    super('Build lock is ' + state + ':' + detail + ' ' + lockPath + '\n' +
      'This build changed no files. Stop all build processes and confirm their Blender children have exited before manually removing this lock directory. Do not remove it while a build is running.\n' +
      'Only after those processes have stopped, run' + (process.platform === 'win32' ? ' in PowerShell' : '') + ':\n  ' + maintenance);
    this.name = 'BuildLockError'; this.lockPath = lockPath; this.state = state; this.owner = owner;
  }
}

export async function acquireBuildLock(kit, {fsOps = fs, inspectOwner = ownerState} = {}) {
  const lockPath = path.join(path.resolve(kit), '.ptp-build.lock');
  try { await fsOps.mkdir(lockPath); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner = null;
    try { owner = JSON.parse(await fsOps.readFile(path.join(lockPath, 'owner.json'), 'utf8')); } catch {}
    throw new BuildLockError(lockPath, inspectOwner(owner), owner);
  }
  const owner = {version: 1, token: randomUUID(), pid: process.pid, host: os.hostname(),
    processStarted: processIdentity(process.pid), startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(), acquiredAt: new Date().toISOString()};
  try { await fsOps.writeFile(path.join(lockPath, 'owner.json'), JSON.stringify(owner, null, 2) + '\n', {flag: 'wx'}); }
  catch (error) { await fsOps.rm(lockPath, {recursive: true, force: true}); throw error; }
  let released = false;
  return {
    path: lockPath, owner,
    async release() {
      if (released) return;
      const current = JSON.parse(await fsOps.readFile(path.join(lockPath, 'owner.json'), 'utf8'));
      if (current.token !== owner.token) throw Error('Build lock ownership changed; it was not removed: ' + lockPath);
      await fsOps.rm(lockPath, {recursive: true});
      released = true;
    },
  };
}
