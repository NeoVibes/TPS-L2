// The page and its data files work without a network: nothing is fetched, nothing comes from
// another site, and every geometry file loads through the real loader and matches the part list.
import './test_setup.mjs';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createLoader} from '../viewer/loading.mjs';
import {pageHtml, modelFile, geometryBytes, fakeDocument} from './kit_files.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const html = pageHtml(), {meta: model, packages: table} = modelFile();

// Scripts come only from the page itself or its own geometry folder; no stylesheet or script from elsewhere.
const sources = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
assert.deepEqual(sources, ['geometry/model.js']);
assert(!/<link[^>]+rel="stylesheet"/i.test(html));
assert(!/(?:src|href)=["'](?:https?:)?\/\//i.test(html));
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
