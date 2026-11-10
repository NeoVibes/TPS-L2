// The secret scan finds each kind of sensitive value and lets ordinary kit text through.
// Samples are assembled at run time so that no real-looking key or address is ever stored in the kit.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {deflateRawSync, crc32} from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {scanText, scanBuffer, scanFiles, filesIn} from '../../publish/scan-secrets.mjs';

const j = (...parts) => parts.join('');
const rules = text => [...new Set(scanText('sample', text).map(f => f.rule))].sort();
const caught = {
  'private-key': j('-----BEGIN ', 'RSA PRIVATE', ' KEY-----'),
  'aws-key': j('AK', 'IA', 'Q3EXAMPLE7KEY2ZZ'),
  'github-token': j('gh', 'p_', 'a'.repeat(36)),
  'anthropic-key': j('sk', '-ant-', 'api03-', 'b'.repeat(30)),
  'openai-key': j('sk', '-proj-', 'c'.repeat(40)),
  'slack-token': j('xo', 'xb-', '1234567890-abcdef'),
  'google-key': j('AI', 'za', 'd'.repeat(35)),
  'stripe-key': j('sk', '_live_', 'e'.repeat(24)),
  'jwt': j('ey', 'JhbGciOiJIUzI1NiJ9', '.ey', 'JzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'f'.repeat(20)),
  'url-login': j('postgres', '://admin:', 'Tr0ub4dor', '@db.internal:5432/app'),
  'password': [j('DB_', 'PASSWORD=', 'hunter2hunter2'), j('{"pass', 'word": "', 'Tr0ub4dor&3"}'), j('my', 'sql -u app -p', 'S3cretValue mydb'), j('Authorization: Bearer ', 'abcdef1234567890')],
  'root-login': [j('ssh ', 'root', '@192.0.2.10'), j('login: ', 'root')],
  'pin': j('PIN', ': ', '4821'),
  'email': j('jane.doe', '@', 'gmail', '.com'),
  'phone': j('(555) ', '867-', '5309'),
  'ssn': j('123', '-45-', '6789'),
  'card': j('4111 ', '1111 ', '1111 ', '1111'),
  'home-path': j('/Us', 'ers/', 'jdoe/Documents'),
};
for (const [rule, samples] of Object.entries(caught))
  for (const sample of [samples].flat()) assert.ok(rules('x\n' + sample + '\nx').includes(rule), rule + ' was not found in a sample');

// Ordinary text in the kit: placeholders, no-reply and example addresses, code, numbers and versions.
const clean = [
  'password: "${DB_PASSWORD}"', 'API_KEY=<your key>', 'token = process.env.TOKEN', 'TOKEN: ${{ secrets.GITHUB_TOKEN }}',
  j('Name <12345+someone', '@users.noreply.github.com>'), j('someone', '@example.com'), j('git', '@github.com:owner/repo.git'),
  'world = M @ v.co', 'p = mat@mesh.vertices[0].co', 'icon@2x.png', 'node 24.22.0', '2026-11-09', 'pin diameter 1.60 mm', 'pin 3 of 8',
  'x = 0.4532015112830366', 'sha256 3c89ec71d5a0e4b9c8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5', '/Users/Shared/Music', 'ssh user@host',
  'Liberation Sans', 'C:\\Users\\you\\Desktop',
].join('\n');
assert.deepEqual(rules(clean), [], 'Ordinary text was reported: ' + scanText('clean', clean).map(f => f.rule + ' ' + f.sample).join(', '));

// This computer's account name is caught; CI machines skip this rule.
if (!process.env.CI && os.userInfo().username.length >= 3 && !/^(?:admin|user|runner|root)$/i.test(os.userInfo().username))
  assert.ok(rules('made by ' + os.userInfo().username).includes('this-computer'), "this computer's user name was not found");

// Files are judged by kind as well as content, binary strings are read, and ZIP entries are opened.
assert.ok(scanBuffer('.claude/settings.local.json', Buffer.from('{}')).some(f => f.rule === 'secret-file'));
assert.ok(scanBuffer('a/.env', Buffer.from('')).some(f => f.rule === 'secret-file'));
assert.ok(!scanBuffer('a/.env.example', Buffer.from('KEY=')).length);
assert.ok(scanBuffer('tag.mp3', Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(caught.email), Buffer.from([0])])).some(f => f.rule === 'email'), 'strings in a binary file were not read');
const zip = (name, data) => {
  const packed = deflateRawSync(data), file = Buffer.from(name), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(file.length, 26);
  central.writeUInt32LE(0x02014b50, 0); local.copy(central, 6, 4, 30); central.writeUInt32LE(0, 42);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + file.length, 12); end.writeUInt32LE(30 + file.length + packed.length, 16);
  return Buffer.concat([local, file, packed, central, file, end]);
};
assert.ok(scanBuffer('kit.zip', zip('kit/notes.txt', Buffer.from(caught['github-token']))).some(f => f.name === 'kit.zip!kit/notes.txt' && f.rule === 'github-token'), 'a ZIP entry was not opened');

// A folder scan includes hidden folders, so a Claude Code settings file left in a repository is caught.
const root = await mkdtemp(path.join(os.tmpdir(), 'ptp-secret-scan-'));
try {
  await mkdir(path.join(root, '.claude'));
  await writeFile(path.join(root, '.claude/settings.local.json'), '{"permissions": {"allow": []}}');
  await writeFile(path.join(root, 'README.md'), 'Nothing to see.');
  const found = scanFiles(filesIn(root).map(f => path.join(root, f)), root);
  assert.deepEqual(found.map(f => f.name + ' ' + f.rule), ['.claude/settings.local.json secret-file']);
} finally { await rm(root, {recursive: true, force: true}); }
console.log('Secret scan: ' + Object.keys(caught).length + ' kinds of sensitive value found; placeholders, code and numbers let through; files, binary strings and ZIP entries read.');
