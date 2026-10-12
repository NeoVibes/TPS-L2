// What the tests need from the built kit, read from view/ the way the page reads it.
import {readFileSync, readdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {VIEW} from '../tools/integrity.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const payload = text => JSON.parse(text.slice(text.indexOf(',') + 1, text.lastIndexOf(')')));

export const pageHtml = () => readFileSync(path.join(VIEW, 'index.html'), 'utf8');
export const modelFile = () => payload(readFileSync(path.join(VIEW, 'geometry/model.js'), 'utf8'));

/** One geometry file as the page receives it: the gzip bytes that the part list's checksum covers. */
export function geometryBytes(name) {
  return Buffer.from(payload(readFileSync(path.join(VIEW, 'geometry', modelFile().packages[name].file), 'utf8')), 'base64');
}
export const geometryBuffer = name => gunzipSync(geometryBytes(name));

/** Every file in view/, relative to it. */
export function viewFiles(folder = '') {
  return readdirSync(path.join(VIEW, folder), {withFileTypes: true}).filter(e => e.name !== '.DS_Store' && e.name !== 'Thumbs.db').flatMap(e => e.isDirectory() ? viewFiles(path.posix.join(folder, e.name)) : [path.posix.join(folder, e.name)]).sort();
}

/** The build record, with the names the tests use. */
export function buildRecord() {
  const record = JSON.parse(readFileSync(path.join(VIEW, 'build-record.json'), 'utf8'));
  return {
    record,
    nativeSha256: record.model_inputs['edit/Portable Tape Player.blend'],
    packages: modelFile().packages,
    sources: Object.fromEntries(Object.entries(record.viewer_inputs).filter(([p]) => p.startsWith('rebuild/')).map(([p, h]) => [p.slice('rebuild/'.length), h])),
    outputs: Object.fromEntries(Object.entries(record.outputs).map(([p, o]) => [p, o.sha256])),
    sha256: sha256(readFileSync(path.join(VIEW, 'build-record.json'))),
  };
}

/** Lets viewer/loading.mjs run under Node: "adding a script tag" runs the data file from view/geometry/. */
export function fakeDocument({fail = () => false} = {}) {
  const requested = [];
  return {requested, createElement: () => ({remove() {}}), head: {append(script) {
    requested.push(script.src);
    queueMicrotask(() => {
      if (fail(script.src)) return script.onerror();
      new Function('portableTapePlayerLoaded', readFileSync(path.join(VIEW, script.src), 'utf8'))(globalThis.portableTapePlayerLoaded);
      script.onload();
    });
  }}};
}
// The page defines this before any data file runs (see viewer/page.html).
globalThis.portableTapePlayerLoaded ||= (name, data) => { globalThis.portableTapePlayerData[name] = data; globalThis.portableTapePlayerWaiting?.[name]?.(); };
