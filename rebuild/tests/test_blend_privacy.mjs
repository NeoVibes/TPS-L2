import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {computerPathsIn} from '../tools/blend_file.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'ptp-blend-privacy-'));
try {
  const privateFolders = [
    ['','Users','Example Person','Documents'].join('/'),
    ['','home','example-person','project'].join('/'),
    ['C:', 'Users', 'Example Person', 'AppData', 'Local', 'Temp', 'fixture'].join('\\'),
    ['d:', 'Users', 'Example Person', 'Documents'].join('/'),
    '/private/tmp/tool-fixture-321/session', '/tmp/tool fixture/session',
    '/var/tmp/fixture', '/private/var/tmp/fixture',
    '/var/folders/ab/synthetic-session/T/fixture', '/private/var/folders/ab/synthetic-session/T/fixture',
    '/run/user/1234/fixture', 'C:\\Windows\\Temp\\fixture', 'D:/Temp/fixture', 'c:\\tmp\\fixture',
    '/tmp/portable-tape-player-private', '/tmp/portable-tape-player/private',
    '/tmp/portable-tape-player/../private',
  ];
  const neutralFolders = ['/tmp/portable-tape-player', '/tmp/portable-tape-player/',
    '/private/tmp/portable-tape-player', '/private/tmp/portable-tape-player/'];
  // Synthetic native byte fixtures avoid Blender and exercise the real reader used by checkKit.
  const nativeBytes = folders => Buffer.from('BLENDER-v502\0' + folders.join('\0') + '\0', 'latin1');
  for (const compressed of [false, true]) {
    const file = path.join(root, compressed ? 'compressed.blend' : 'plain.blend');
    const write = async folders => {
      const data = nativeBytes(folders);
      await writeFile(file, compressed ? zlib.zstdCompressSync(data) : data);
    };
    await write([...neutralFolders, '//relative/project', 'Portable Tape Player']);
    assert.deepEqual(await computerPathsIn(file), [], 'Neutral publishing folders must remain shareable');
    await write([...neutralFolders, ...privateFolders, privateFolders[0]]);
    assert.deepEqual(await computerPathsIn(file), privateFolders,
      'Home and temporary profile paths must be reported intact, including spaces, and deduplicated');
  }
  console.log('Blender privacy: home and temporary profiles detected; exact neutral folder allowed in raw and compressed files.');
} finally { await rm(root, {recursive: true, force: true}); }
