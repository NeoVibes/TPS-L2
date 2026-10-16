// Extract our ZIP and compare every byte with the manifest captured before packaging.
// This does not rebuild output or rerun browser tests on identical files.
import {inflateRawSync, crc32} from 'node:zlib';
import {mkdtemp, mkdir, writeFile, readFile, rm, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {hash} from '../rebuild/tools/integrity.mjs';

export async function verifyZip(bytes, prefix, expected) {
  const safeName = name => typeof name === 'string' && !name.includes('\\') && !name.includes('\0') &&
    name.split('/').every(part => part && part !== '.' && part !== '..' && !part.includes(':'));
  if (!safeName(prefix) || prefix.includes('/')) throw Error('Invalid ZIP root');
  if (!expected || Array.isArray(expected) || typeof expected !== 'object' ||
    Object.entries(expected).some(([name, digest]) => !safeName(name) || !/^[a-f0-9]{64}$/.test(digest))) throw Error('Invalid ZIP candidate manifest');
  const need = (offset, length, end = bytes.length) => {
    if (offset < 0 || length < 0 || offset + length > end) throw Error('Truncated ZIP structure');
  };
  // Our writer emits classic, single-volume ZIPs with no comments or extra fields.
  // Parse the directory used by normal extractors, rather than trusting only the
  // local records: a missing or corrupt central directory makes a ZIP unusable.
  need(0, 22);
  const end = bytes.length - 22;
  if (bytes.readUInt32LE(end) !== 0x06054b50 || bytes.readUInt16LE(end + 20) !== 0) throw Error('Missing or unsupported ZIP end record');
  const count = bytes.readUInt16LE(end + 10), directoryLength = bytes.readUInt32LE(end + 12), directoryStart = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0 || bytes.readUInt16LE(end + 8) !== count) throw Error('Multi-volume ZIPs are not supported');
  if (count === 0xffff || directoryLength === 0xffffffff || directoryStart === 0xffffffff) throw Error('ZIP64 is not supported');
  if (count !== Object.keys(expected).length || directoryStart + directoryLength !== end) throw Error('ZIP directory or inventory differs from validated candidate');
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'ptp-zip-'));
  try {
    const found = new Set();
    let offset = 0, directory = directoryStart;
    for (let i = 0; i < count; i++) {
      need(directory, 46, end);
      if (bytes.readUInt32LE(directory) !== 0x02014b50) throw Error('Invalid ZIP central directory entry');
      const version = bytes.readUInt16LE(directory + 6), flags = bytes.readUInt16LE(directory + 8), method = bytes.readUInt16LE(directory + 10);
      const checksum = bytes.readUInt32LE(directory + 16), packedLength = bytes.readUInt32LE(directory + 20), length = bytes.readUInt32LE(directory + 24);
      const nameLength = bytes.readUInt16LE(directory + 28), extraLength = bytes.readUInt16LE(directory + 30), commentLength = bytes.readUInt16LE(directory + 32);
      const localOffset = bytes.readUInt32LE(directory + 42);
      if (version !== 20 || flags !== 0x0800 || method !== 8 || extraLength || commentLength || bytes.readUInt16LE(directory + 34) !== 0 ||
        packedLength === 0xffffffff || length === 0xffffffff || localOffset === 0xffffffff) throw Error('Unsupported ZIP entry features');
      if (((bytes.readUInt32LE(directory + 38) >>> 16) & 0xf000) !== 0x8000) throw Error('ZIP entry is not an ordinary file');
      need(directory + 46, nameLength, end);
      const nameBytes = bytes.subarray(directory + 46, directory + 46 + nameLength);
      const full = new TextDecoder('utf-8', {fatal: true}).decode(nameBytes);
      if (!full.startsWith(prefix + '/')) throw Error('Unexpected ZIP root: ' + full);
      const name = full.slice(prefix.length + 1);
      if (!safeName(name) || !Object.hasOwn(expected, name) || found.has(name)) throw Error('Unexpected or duplicate ZIP entry: ' + name);
      // The writer emits local entries in directory order, without gaps or data
      // descriptors. Compare both copies of every field that governs extraction.
      if (localOffset !== offset) throw Error('ZIP local-header offset differs: ' + name);
      need(offset, 30 + nameLength, directoryStart);
      if (bytes.readUInt32LE(offset) !== 0x04034b50 || bytes.readUInt16LE(offset + 4) !== version ||
        bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== method ||
        bytes.readUInt32LE(offset + 10) !== bytes.readUInt32LE(directory + 12) ||
        bytes.readUInt32LE(offset + 14) !== checksum || bytes.readUInt32LE(offset + 18) !== packedLength ||
        bytes.readUInt32LE(offset + 22) !== length || bytes.readUInt16LE(offset + 26) !== nameLength || bytes.readUInt16LE(offset + 28) !== 0 ||
        !bytes.subarray(offset + 30, offset + 30 + nameLength).equals(nameBytes)) throw Error('ZIP local and central headers differ: ' + name);
      const start = offset + 30 + nameLength;
      need(start, packedLength, directoryStart);
      const content = inflateRawSync(bytes.subarray(start, start + packedLength), {maxOutputLength: Math.max(1, length)});
      if (content.length !== length || crc32(content) !== checksum) throw Error('Damaged ZIP entry: ' + name);
      const file = path.join(root, name);
      await mkdir(path.dirname(file), {recursive: true}); await writeFile(file, content);
      if (hash(await readFile(file)) !== expected[name]) throw Error('Packaged bytes differ from validated candidate: ' + name);
      found.add(name); offset = start + packedLength;
      directory += 46 + nameLength;
    }
    if (offset !== directoryStart || directory !== end || found.size !== Object.keys(expected).length) throw Error('ZIP inventory differs from validated candidate');
    return found.size;
  } finally { await rm(root, {recursive: true, force: true}); }
}
