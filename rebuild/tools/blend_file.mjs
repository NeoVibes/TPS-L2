// Reads the Blender file's raw contents without Blender, to look for things that should not be shared.
import zlib from 'node:zlib';
import {readFile} from 'node:fs/promises';

/** The uncompressed bytes of a .blend file. Blender saves a series of zstd frames plus a seek table. */
export async function readBlend(file) {
  const data = await readFile(file);
  if (data.subarray(0, 7).toString('latin1') === 'BLENDER') return data;
  const out = []; let offset = 0;
  while (offset + 8 <= data.length) {
    const magic = data.readUInt32LE(offset);
    if ((magic & 0xfffffff0) === 0x184d2a50) { offset += 8 + data.readUInt32LE(offset + 4); continue; }   // skippable frame (the seek table)
    if (magic !== 0xfd2fb528) throw new Error('This does not look like a Blender file.');
    // Walk the frame's blocks to find where it ends.
    let p = offset + 4; const descriptor = data[p++];
    const single = (descriptor >> 5) & 1, dictionary = descriptor & 3, contentSize = descriptor >> 6, checksum = (descriptor >> 2) & 1;
    if (!single) p += 1;
    p += [0, 1, 2, 4][dictionary];
    p += contentSize === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][contentSize];
    for (;;) { const header = data.readUIntLE(p, 3); p += 3; const last = header & 1, type = (header >> 1) & 3, size = header >> 3; p += type === 1 ? 1 : size; if (last) break; }
    if (checksum) p += 4;
    out.push(zlib.zstdDecompressSync(data.subarray(offset, p)));
    offset = p;
  }
  return Buffer.concat(out);
}

/** Home or temporary folder paths from the computer that saved the file. Empty when there are none. */
export async function computerPathsIn(file) {
  const text = (await readBlend(file)).toString('latin1');
  // File-browser folders are stored as printable, NUL-terminated strings. Temporary profiles can
  // identify a user, tool or session just as home folders do, including macOS's per-user temp root.
  const folders = /(?:\/Users\/|\/home\/|[A-Z]:[\\/]Users[\\/]|\/(?:private\/)?(?:tmp|var\/tmp|var\/folders)\/|\/run\/user\/|[A-Z]:[\\/](?:Windows[\\/])?(?:Temp|tmp)[\\/])[\x20-\x7e]*/gi;
  const paths = [...text.matchAll(folders)].map(match => match[0].trimEnd());
  // The publishing cleaner uses this exact neutral folder. Do not exempt arbitrary descendants,
  // similar prefixes or parent traversals, which could still expose machine-specific information.
  return [...new Set(paths.filter(folder => !/^\/(?:private\/)?tmp\/portable-tape-player\/?$/.test(folder)))];
}
