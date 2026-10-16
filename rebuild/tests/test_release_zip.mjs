import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import path from 'node:path';
import {KIT, hash} from '../tools/integrity.mjs';
import {zipFiles} from '../../publish/release.mjs';
import {verifyZip} from '../../publish/verify-zip.mjs';

// Equal-length names let the duplicate/name-corruption cases retain otherwise
// valid offsets. These are real source files; no build or native files are needed.
const files = ['rebuild/viewer/app-camera.mjs', 'rebuild/viewer/app-labels.mjs'];
const prefix = 'Portable Tape Player fixture';
const expected = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(path.join(KIT, file)))])));
const original = zipFiles(files, prefix, new Date('2026-01-01T00:00:00Z'));
const end = original.length - 22, directory = original.readUInt32LE(end + 16);
const nameLength = original.readUInt16LE(directory + 28), second = directory + 46 + nameLength;
const secondLocal = original.readUInt32LE(second + 42);
const corrupt = mutate => { const bytes = Buffer.from(original); mutate(bytes); return bytes; };

test('Classic ZIP extraction matches every validated candidate byte', async () => {
  assert.equal(await verifyZip(original, prefix, expected), files.length);
});

test('ZIP verification rejects missing/truncated central directory and end records', async () => {
  for (const bytes of [original.subarray(0, directory + 4), original.subarray(0, end), original.subarray(0, original.length - 1)]) {
    await assert.rejects(() => verifyZip(bytes, prefix, expected));
  }
  await assert.rejects(() => verifyZip(corrupt(bytes => bytes.writeUInt32LE(0, directory)), prefix, expected), /central directory/);
  for (const field of [12, 16]) await assert.rejects(() => verifyZip(corrupt(bytes => bytes.writeUInt32LE(bytes.readUInt32LE(end + field) + 1, end + field)), prefix, expected), /directory/);
});

test('ZIP verification rejects central/local name, offset, length and checksum disagreements', async () => {
  const mutations = [
    bytes => { bytes[directory + 46 + nameLength - 1] ^= 1; },
    bytes => { bytes[30 + nameLength - 1] ^= 1; },
    bytes => bytes.writeUInt32LE(1, directory + 42),
    ...[16, 20, 24].map(field => bytes => bytes.writeUInt32LE((bytes.readUInt32LE(directory + field) + 1) >>> 0, directory + field)),
  ];
  for (const mutate of mutations) await assert.rejects(() => verifyZip(corrupt(mutate), prefix, expected));
});

test('ZIP verification rejects duplicate entries and a changed candidate inventory', async () => {
  const duplicate = corrupt(bytes => {
    const name = bytes.subarray(directory + 46, directory + 46 + nameLength);
    name.copy(bytes, second + 46); name.copy(bytes, secondLocal + 30);
  });
  await assert.rejects(() => verifyZip(duplicate, prefix, expected), /duplicate/);
  const missing = {...expected}; delete missing[files[1]];
  await assert.rejects(() => verifyZip(original, prefix, missing), /inventory/);
  await assert.rejects(() => verifyZip(original, prefix, {...expected, 'extra.txt': hash('extra')}), /inventory/);
  await assert.rejects(() => verifyZip(original, prefix, {...expected, [files[1]]: hash('different bytes')}), /Packaged bytes differ/);
});

test('ZIP verification checks CRC and decompressed bytes even when both headers agree', async () => {
  const wrongCRC = corrupt(bytes => {
    const checksum = (bytes.readUInt32LE(directory + 16) ^ 1) >>> 0;
    bytes.writeUInt32LE(checksum, directory + 16); bytes.writeUInt32LE(checksum, 14);
  });
  await assert.rejects(() => verifyZip(wrongCRC, prefix, expected), /Damaged/);
  const damagedPayload = corrupt(bytes => { bytes[30 + nameLength] ^= 0xff; });
  await assert.rejects(() => verifyZip(damagedPayload, prefix, expected));
});

test('ZIP verification rejects ZIP64, multi-volume, descriptors, encryption and unsupported entries', async () => {
  const mutations = [
    bytes => { bytes.writeUInt16LE(0xffff, end + 8); bytes.writeUInt16LE(0xffff, end + 10); },
    bytes => bytes.writeUInt32LE(0xffffffff, end + 12),
    bytes => bytes.writeUInt16LE(1, end + 4),
    bytes => bytes.writeUInt16LE(1, directory + 34),
    bytes => bytes.writeUInt16LE(45, directory + 6),
    bytes => bytes.writeUInt16LE(0x0808, directory + 8),
    bytes => bytes.writeUInt16LE(0x0801, directory + 8),
    bytes => bytes.writeUInt16LE(0, directory + 10),
    bytes => bytes.writeUInt16LE(1, directory + 30),
    bytes => bytes.writeUInt32LE((0o120777 << 16) >>> 0, directory + 38),
  ];
  for (const mutate of mutations) await assert.rejects(() => verifyZip(corrupt(mutate), prefix, expected));
});
