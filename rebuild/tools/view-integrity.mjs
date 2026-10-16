// Validate saved output independently of source freshness. Callers always name the directory.
import {readFile, readdir, lstat, realpath} from 'node:fs/promises';
import path from 'node:path';
import {hash} from './integrity.mjs';
import {readView} from './compare.mjs';

const safePath = name => typeof name === 'string' && name.length > 0 &&
  !name.includes('\\') && !name.includes('\0') && !path.posix.isAbsolute(name) &&
  name.split('/').every(part => part && part !== '.' && part !== '..' && !part.includes(':'));

export async function fileInventory(root) {
  root = path.resolve(root);
  if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== root) throw Error('Links are not allowed: ' + root);
  const files = [];
  async function visit(relative) {
    for (const entry of await readdir(path.join(root, relative), {withFileTypes: true})) {
      const name = path.posix.join(relative, entry.name);
      if (!safePath(name)) throw Error('Unsafe output path: ' + name);
      if (entry.isSymbolicLink()) throw Error('Links are not allowed: ' + name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) files.push(name);
      else throw Error('Output is not a regular file: ' + name);
    }
  }
  await visit('');
  return files.sort();
}

export async function outputManifest(root, files = null) {
  const result = {};
  for (const name of (files || await fileInventory(root)).slice().sort()) {
    if (!safePath(name)) throw Error('Unsafe output path: ' + name);
    const bytes = await readFile(path.join(root, name));
    result[name] = {sha256: hash(bytes), bytes: bytes.length};
  }
  return result;
}

/** geometryOnly checks reused geometry against the OLD record, never current sources. */
export async function validateView(root, {record = null, geometryOnly = false} = {}) {
  const actual = await fileInventory(root);
  record ??= JSON.parse(await readFile(path.join(root, 'build-record.json'), 'utf8'));
  if (!record.outputs || typeof record.outputs !== 'object' || Array.isArray(record.outputs)) throw Error('Missing output manifest');
  for (const [name, entry] of Object.entries(record.outputs)) {
    if (!safePath(name) || name === 'build-record.json') throw Error('Unsafe manifest path: ' + name);
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw Error('Invalid manifest entry: ' + name);
  }
  const selected = name => !geometryOnly || name.startsWith('geometry/');
  const expected = Object.keys(record.outputs).filter(selected).sort();
  if (!geometryOnly) for (const required of ['index.html', 'master-parts.csv', 'TARGETS.md', 'assessment-results.json']) {
    if (!expected.includes(required)) throw Error('The manifest must include ' + required);
  }
  const found = actual.filter(name => selected(name) && name !== 'build-record.json');
  const missing = expected.filter(name => !found.includes(name)), extra = found.filter(name => !expected.includes(name));
  if (missing.length || extra.length) throw Error('Output inventory differs: ' + [missing.length && 'missing ' + missing.join(', '), extra.length && 'unexpected ' + extra.join(', ')].filter(Boolean).join('; '));
  for (const name of expected) {
    const bytes = await readFile(path.join(root, name)), entry = record.outputs[name];
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw Error(name + ' was changed after it was built');
  }
  if (!expected.includes('geometry/model.js')) throw Error('The manifest must include geometry/model.js');
  const modelText = await readFile(path.join(root, 'geometry/model.js'), 'utf8');
  const model = JSON.parse(modelText.slice(modelText.indexOf(',', modelText.indexOf('(')) + 1, modelText.lastIndexOf(')')));
  const geometry = ['geometry/model.js'];
  for (const entry of Object.values(model.packages)) {
    if (!safePath(entry.file)) throw Error('Unsafe geometry package path');
    geometry.push('geometry/' + entry.file);
  }
  if (new Set(geometry).size !== geometry.length || JSON.stringify(geometry.sort()) !== JSON.stringify(expected.filter(name => name.startsWith('geometry/')))) throw Error('Geometry package inventory does not match its manifest');
  return {record, view: await readView(root)};
}
