// The page and its data files work without a network: runtime resources are local, and every
// geometry file loads through the real loader and matches the part list. Navigation links are optional.
import './test_setup.mjs';
import assert from 'node:assert/strict';
import {writeFileSync, readFileSync} from 'node:fs';
import {VIEW} from '../tools/integrity.mjs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createLoader} from '../viewer/loading.mjs';
import {pageHtml, modelFile, geometryBytes, fakeDocument} from './kit_files.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const html = pageHtml(), {meta: model, packages: table} = modelFile();

// Scripts come only from the page itself or its own folder; no stylesheet or script from elsewhere.
const sources = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
assert.deepEqual(sources, ['theme-init.js', 'geometry/model.js']);
assert(html.indexOf('<script src="theme-init.js"></script>') < html.indexOf('<body'), 'stored theme applies in the head before content paints');
assert.equal(readFileSync(path.join(VIEW, 'theme-init.js'), 'utf8'), readFileSync('viewer/theme-init.js', 'utf8'), 'the standalone bootstrap ships intact');
assert(!/<link[^>]+rel="stylesheet"/i.test(html));
// A user-followed repository link does not fetch a resource or make offline startup depend on it.
assert(!/(?:src|href)=["'](?:https?:)?\/\//i.test(html.replace(/<a\b[^>]*>/gi, '')));
assert(html.includes('<a href="https://github.com/NeoVibes/TPS-L2" target="_blank" rel="noopener noreferrer">View the project on GitHub</a>'));
const policy = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
assert(policy.includes("default-src 'none'") && policy.includes("connect-src 'none'") && policy.includes("script-src 'unsafe-inline' 'self'"));
assert(!html.includes('component-evidence'));

const prior = globalThis.document, packages = {};
try {
  globalThis.document = fakeDocument();
  const loader = createLoader({packages: table});
  for (const [name, entry] of Object.entries(table)) {
    const bytes = geometryBytes(name);
    assert.equal(sha(bytes), entry.sha256); assert.equal(bytes.length, entry.bytes);
    const decoded = Buffer.from(await loader.load(name));
    assert.deepEqual(decoded, gunzipSync(bytes)); assert.equal(decoded.length, entry.rawBytes);
    packages[name] = {sha256: entry.sha256, bytes: bytes.length, rawBytes: decoded.length};
  }
} finally { globalThis.document = prior; }

const report = {passed: true, nativeSha256: model.source_sha256, pageSha256: sha(html), components: model.parts.length, packages,
  scope: 'Page parsed; every geometry file loaded through the production loader, hashed and unpacked. Does not show that a browser will open it from disk; that is checked by hand.'};
writeFileSync('build/test-results/offline-tests.json', JSON.stringify(report, null, 2) + '\n');
console.log('Offline page verified:', model.parts.length, 'parts,', Object.keys(packages).length, 'geometry files');
