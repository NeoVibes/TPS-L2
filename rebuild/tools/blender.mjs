import {spawnSync} from 'node:child_process';
import {access, readdir} from 'node:fs/promises';
import path from 'node:path';

export const TESTED_BLENDER = '5.2';
const accessible = file => access(file).then(() => true, () => false);
const versionProbe = executable => spawnSync(executable,
  ['--background', '--factory-startup', '--disable-autoexec', '--version'],
  {encoding: 'utf8', timeout: 10000, maxBuffer: 64 * 1024});

/** Automatically discovered candidates, in PATH order followed by usual installations. */
export async function blenderCandidates({env = process.env, platform = process.platform, readDirectory = readdir} = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const executable = platform === 'win32' ? 'blender.exe' : 'blender';
  const candidates = (env.PATH || '').split(paths.delimiter).map(folder => paths.join(folder, executable));
  if (platform === 'darwin') {
    candidates.push('/Applications/Blender.app/Contents/MacOS/Blender');
    if (env.HOME) candidates.push(paths.join(env.HOME, 'Applications/Blender.app/Contents/MacOS/Blender'));
  }
  if (platform === 'win32') for (const root of [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean)) {
    const folder = paths.join(root, 'Blender Foundation');
    try { for (const name of (await readDirectory(folder)).sort().reverse()) candidates.push(paths.join(folder, name, executable)); } catch {}
  }
  return [...new Set(candidates)];
}

/** BLENDER_BIN is authoritative; automatic discovery may inspect several installations. */
export async function findBlender({env = process.env, platform = process.platform, candidates,
  exists = accessible, probe = versionProbe, readDirectory = readdir, note = console.log} = {}) {
  const explicit = Boolean(env.BLENDER_BIN);
  const choices = explicit ? [env.BLENDER_BIN] : candidates ?? await blenderCandidates({env, platform, readDirectory});
  const rejected = [];
  for (const executable of [...new Set(choices)]) {
    let reason;
    try {
      if (!await exists(executable)) reason = 'missing or inaccessible';
      else {
        const result = await probe(executable);
        const match = result.stdout?.match(/Blender (\d+)\.(\d+)\.(\d+)/);
        if (result.error) reason = result.error.message;
        else if (result.status !== 0) reason = 'version probe exited ' + (result.status ?? result.signal ?? 'without a status');
        else if (!match) reason = 'version probe did not report a Blender version';
        else {
          const version = match.slice(1).join('.');
          if (Number(match[1]) < 5 || Number(match[1]) === 5 && Number(match[2]) < 2)
            reason = 'Blender ' + version + ' is too old; ' + TESTED_BLENDER + ' or newer is required';
          else {
            if (match[1] + '.' + match[2] !== TESTED_BLENDER)
              note('Note: this is Blender ' + version + '. The kit is tested with ' + TESTED_BLENDER + '; results may differ slightly, and the change report will show it.');
            return {executable, version};
          }
        }
      }
    } catch (error) {
      reason = error.message;
    }
    rejected.push(executable + ': ' + reason);
  }
  const instruction = explicit ? 'Fix BLENDER_BIN; automatic discovery is disabled while it is set.' : 'Install Blender ' + TESTED_BLENDER + ' or newer, or set BLENDER_BIN to its executable.';
  throw Error('No compatible Blender was found. ' + instruction + '\n' + rejected.join('\n'));
}
