// Directory replacement while the caller holds the kit's build lock. All names are siblings,
// so rename stays on one filesystem. This is process-failure handling, not power-loss recovery.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

async function present(file, fsOps) {
  try { await fsOps.lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export class DirectoryTransactionError extends Error {
  constructor(message, {cause, phase, unchanged, live, recoveryPaths = []}) {
    super(message, {cause});
    this.name = 'DirectoryTransactionError';
    this.phase = phase;
    this.unchanged = unchanged;
    this.live = live;
    this.recoveryPaths = recoveryPaths;
  }
}

/** Make an empty staging directory. Validate its complete contents before calling commit(). */
export async function createDirectoryTransaction(live, {fsOps = fs} = {}) {
  live = path.resolve(live);
  const parent = path.dirname(live), base = path.basename(live), id = randomUUID();
  const stage = path.join(parent, '.' + base + '.staging-' + id);
  const backup = path.join(parent, '.' + base + '.previous-' + id);
  await fsOps.mkdir(stage);
  let committed = false, attempted = false, preserve = false;
  return {
    live, stage, backup,
    async commit() {
      if (attempted) throw Error('This directory transaction was already attempted.');
      attempted = true;
      let movedOld = false;
      try {
        const info = await fsOps.lstat(stage);
        if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Staging must be a real directory.');
        if (await present(backup, fsOps)) throw Error('The unique backup path already exists: ' + backup);
        if (await present(live, fsOps)) { await fsOps.rename(live, backup); movedOld = true; }
      } catch (cause) {
        throw new DirectoryTransactionError('Could not prepare the replacement of ' + live + ': ' + cause.message, {cause, phase: 'before-commit', unchanged: true, live});
      }
      try { await fsOps.rename(stage, live); }
      catch (cause) {
        if (movedOld) {
          try { await fsOps.rename(backup, live); }
          catch (rollback) {
            preserve = true;
            throw new DirectoryTransactionError('Replacement and rollback failed. Preserve ' + backup + ' (previous output) and ' + stage + ' (staged output). ' + rollback.message,
              {cause: new AggregateError([cause, rollback]), phase: 'rollback', unchanged: false, live, recoveryPaths: [backup, stage]});
          }
        }
        throw new DirectoryTransactionError('Could not install the replacement of ' + live + '; the previous output is unchanged. ' + cause.message,
          {cause, phase: 'before-commit', unchanged: true, live});
      }
      committed = true;
      const warnings = [];
      if (movedOld) {
        try { await fsOps.rm(backup, {recursive: true, force: true}); }
        catch (error) { warnings.push('New output is committed at ' + live + ', but backup cleanup failed: ' + backup + '. ' + error.message); }
      }
      return {committed: true, warnings, ...(warnings.length ? {backup} : {})};
    },
    async discard() {
      // A failed rollback needs both copies for manual recovery. Never erase either here.
      if (!committed && !preserve) await fsOps.rm(stage, {recursive: true, force: true});
    },
  };
}

/** Call only after acquiring the normal build lock. A valid live copy is required for cleanup. */
export async function cleanupLeftovers(live, {verify, fsOps = fs} = {}) {
  if (typeof verify !== 'function') throw Error('Leftover cleanup requires live-output integrity verification.');
  live = path.resolve(live);
  const base = path.basename(live), parent = path.dirname(live);
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const unique = new RegExp('^\\.' + escaped + '\\.(?:staging|previous)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  const names = (await fsOps.readdir(parent)).filter(name => unique.test(name) || name === base + '.staging' || name === base + '.previous');
  if (!names.length) return {removed: [], warnings: []};
  const leftovers = names.map(name => path.join(parent, name));
  try {
    if (!await present(live, fsOps)) throw Error('The live directory is missing.');
    await verify(live);
  } catch (cause) {
    throw new DirectoryTransactionError('Leftovers were preserved because ' + live + ' could not be verified. Inspect: ' + leftovers.join(', ') + '. ' + cause.message,
      {cause, phase: 'leftovers', unchanged: true, live, recoveryPaths: leftovers});
  }
  const removed = [], warnings = [];
  for (const leftover of leftovers) {
    try {
      const info = await fsOps.lstat(leftover);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Not a real build directory; inspect it manually.');
      await fsOps.rm(leftover, {recursive: true, force: true});
      removed.push(leftover);
    } catch (error) { warnings.push('Could not remove abandoned build directory ' + leftover + ': ' + error.message); }
  }
  return {removed, warnings};
}
