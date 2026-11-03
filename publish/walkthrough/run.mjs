// node publish/walkthrough/run.mjs [--file | --hosted] [--only=name,name] [--update-reference]
//
// Checks the built viewer in one headless Chrome: a walkthrough of every control compared with the reference
// record in reference/, the parts list, the exterior versions, damaged files, and regression checks (inspector,
// catalog, preferences, failure recovery, loading races, themes and contrast, keyboard zoom, interrupted
// STOP/EJECT). Opened from disk everything runs; served from a web-host style subfolder on this computer
// (hosted), only what loading over HTTP can change: startup, preferences, failures, loading races and theme
// startup. Both run unless --file or --hosted is given. Needs Chrome, Node and rebuild's installed packages
// (axe-core); evidence goes to rebuild/build/walkthrough/.
//
//   --only=races,theme-startup   just these checks (names as printed), while working on something
//   --update-reference           after you have checked that a behaviour change is intended, records it
import {readFileSync, writeFileSync, mkdirSync, createReadStream, statSync, realpathSync} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {openBrowser} from './chrome.mjs';
import mainSteps from './main-steps.mjs';
import controlSteps from './control-steps.mjs';
import listSteps from './list-steps.mjs';
import exteriorSteps from './exterior-steps.mjs';
import brokenFiles from './broken-files.mjs';
import * as checks from './checks.mjs';
import * as theme from './theme.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), kit = path.resolve(here, '../..');
const view = path.join(kit, 'view'), scratch = path.join(kit, 'rebuild/build/walkthrough');
const args = process.argv.slice(2), update = args.includes('--update-reference');
const only = args.find(a => a.startsWith('--only='))?.slice(7).split(',');
const protocols = args.includes('--file') ? ['file'] : args.includes('--hosted') ? ['hosted'] : ['file', 'hosted'];
mkdirSync(scratch, {recursive: true});

// A tiny read-only server on this computer only, so the page can be tried the way a web host serves it.
const root = realpathSync(view), prefix = '/demo/player/';
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, name.startsWith(prefix) ? name.slice(prefix.length) || 'index.html' : '\0');
  try { if (!file.startsWith(root + path.sep) || !statSync(file).isFile()) throw 0; res.writeHead(200, {'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript'}); createReadStream(file).pipe(res); }
  catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const urls = {file: pathToFileURL(path.join(view, 'index.html')).href, hosted: 'http://127.0.0.1:' + server.address().port + prefix};
// The walkthrough steps take the page's file path or its http address.
const targets = {file: path.join(view, 'index.html'), hosted: urls.hosted};

// Numbers must match exactly, except where controls sit on screen (pixels), which shift slightly as the camera settles.
function differences(a, b, where = '') {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= (where.includes('.controls.') ? 6 : 1e-9) ? [] : [where + ': ' + a + ' → ' + b];
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? [] : [where + ': ' + JSON.stringify(a)?.slice(0, 60) + ' → ' + JSON.stringify(b)?.slice(0, 60)];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => k in a && k in b ? differences(a[k], b[k], where + '.' + k) : [where + '.' + k + (k in a ? ': gone' : ': new')]);
}

const browser = await openBrowser();
// The walkthrough steps open pages with browser.page(); each run gets a fresh context, so nothing is shared.
async function isolated(fn) { const context = await browser.context(); try { return await fn({page: o => context.page(o), sleep: browser.sleep}); } finally { await context.close(); } }
async function walkthrough(name, steps, url) {
  const record = path.join(scratch, name + '.json');
  await isolated(b => steps(b, url, record));
  const got = JSON.parse(readFileSync(record, 'utf8')), referenceFile = path.join(here, 'reference', name + '.json');
  if (got.crashed) throw Error(name + ' steps did not finish: ' + got.crashed.split('\n')[0]);
  if (got.errors?.length) throw Error('browser errors: ' + got.errors.join('; '));
  if (update) { writeFileSync(referenceFile, JSON.stringify({what: 'What the accepted viewer does at each step of the walkthrough. Written by run.mjs --update-reference.', steps: got.steps}, null, 1) + '\n'); return 'reference updated'; }
  const found = differences(JSON.parse(readFileSync(referenceFile, 'utf8')).steps, got.steps);
  if (found.length) throw Error(found.length + ' differences from the reference:\n        ' + found.slice(0, 15).join('\n        '));
  return Object.keys(got.steps).length + ' steps match the reference';
}
const ok = value => { if (value === false) throw Error('see the WRONG lines above'); };

const CHECKS = [
  {name: 'main', file: true, update: true, run: (url, record, protocol) => walkthrough('main', mainSteps, targets[protocol])},
  {name: 'controls', file: true, update: true, run: (url, record, protocol) => walkthrough('controls', controlSteps, targets[protocol])},
  {name: 'list', file: true, run: async (url, record, protocol) => ok(await isolated(b => listSteps(b, targets[protocol], view)))},
  {name: 'exterior', file: true, run: async (url, record, protocol) => ok(await isolated(b => exteriorSteps(b, targets[protocol])))},
  {name: 'broken', file: true, run: async () => ok(await isolated(b => brokenFiles(b, view, path.join(scratch, 'broken-view'))))},
  {name: 'viewer', file: true, hosted: true, run: (url, record, protocol) => checks.viewerChecks({browser, url, record, output: scratch, full: protocol === 'file', theme})},
  {name: 'interaction', file: true, run: (url, record) => checks.interactionChecks({browser, url, record, output: scratch})},
  {name: 'catalog', file: true, run: (url, record) => checks.catalogChecks({browser, url, record})},
  {name: 'preferences', file: true, hosted: true, run: (url, record) => checks.preferenceChecks({browser, url, record, output: scratch})},
  {name: 'failures', file: true, hosted: true, run: (url, record) => checks.failureChecks({browser, url, record, output: scratch})},
  {name: 'races', file: true, hosted: true, run: (url, record) => checks.loadingRaceChecks({browser, url, record})},
  {name: 'theme-startup', file: true, hosted: true, run: (url, record) => theme.themeStartup({browser, url, record, output: scratch})},
  {name: 'music', file: true, hosted: true, run: (url, record) => checks.musicChecks({browser, url, record})},
];

const results = [], started = Date.now();
try {
  for (const protocol of protocols) for (const check of CHECKS) {
    if (!check[protocol] || (only && !only.includes(check.name)) || (update && !check.update)) continue;
    const record = {check: check.name, protocol, passed: false}, start = Date.now();
    try { record.note = await check.run(urls[protocol], record, protocol) || undefined; record.passed = true; }
    catch (error) { record.error = String(error.stack || error); }
    record.seconds = +((Date.now() - start) / 1000).toFixed(1);
    results.push(record);
    console.log(`${record.passed ? 'ok   ' : 'WRONG'} ${check.name.padEnd(13)} ${protocol.padEnd(6)} ${String(record.seconds).padStart(6)} s${record.note ? '  ' + record.note : ''}`);
    if (record.error) console.log('        ' + (record.phase ? 'phase ' + record.phase + ': ' : '') + record.error.split('\n').slice(0, 6).join('\n        '));
  }
} finally { await browser.close(); server.close(); }
const passed = results.every(r => r.passed), seconds = +((Date.now() - started) / 1000).toFixed(1);
writeFileSync(path.join(scratch, 'summary.json'), JSON.stringify({passed, seconds, browser: browser.version, platform: process.platform + ' ' + process.arch, results}, null, 1) + '\n');
console.log(`\n${passed ? 'The viewer passes' : 'The viewer FAILS'} ${results.length} checks in ${seconds} s (${browser.version}; details in rebuild/build/walkthrough/summary.json).`);
process.exitCode = passed && results.length ? 0 : 1;
