// node publish/walkthrough/run.mjs [--hosted] [--update-reference]
//
// Opens the built viewer in headless Chrome and walks it through every control, then compares what
// it saw with the reference record in reference/. Also uses the parts list and the exterior-version
// choice, and checks how the page copes with missing and damaged geometry files. Needs Chrome and
// Node; nothing else.
//
//   (no flag)            opens view/index.html straight from disk, as a double-click would
//   --hosted             serves view/ from a web-host style subfolder on this computer and opens that
//   --update-reference   after you have checked that a behaviour change is intended, records it
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync, createReadStream, statSync, realpathSync} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), kit = path.resolve(here, '../..');
const view = path.join(kit, 'view'), scratch = path.join(kit, 'rebuild/build/walkthrough');
const hosted = process.argv.includes('--hosted'), update = process.argv.includes('--update-reference');
mkdirSync(scratch, {recursive: true});

// A tiny read-only server on this computer only, so the page can be tried the way a web host serves it.
let server, target = path.join(view, 'index.html');
if (hosted) {
  const root = realpathSync(view), prefix = '/demo/player/';
  server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, name.startsWith(prefix) ? name.slice(prefix.length) || 'index.html' : '\0');
    try { if (!file.startsWith(root + path.sep) || !statSync(file).isFile()) throw 0; res.writeHead(200, {'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript'}); createReadStream(file).pipe(res); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  target = 'http://127.0.0.1:' + server.address().port + prefix;
}

// Numbers must match exactly, except where controls sit on screen (pixels), which shift slightly as the camera settles.
function differences(a, b, where = '') {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= (where.includes('.controls.') ? 6 : 1e-9) ? [] : [where + ': ' + a + ' → ' + b];
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? [] : [where + ': ' + JSON.stringify(a)?.slice(0, 60) + ' → ' + JSON.stringify(b)?.slice(0, 60)];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => k in a && k in b ? differences(a[k], b[k], where + '.' + k) : [where + '.' + k + (k in a ? ': gone' : ': new')]);
}

// Each part runs as its own process. They must not block this one: in --hosted mode it is the server.
const runScript = (script, ...args) => new Promise(done => spawn(process.execPath, [path.join(here, script), ...args], {stdio: 'inherit'}).on('close', done));

let failed = false;
for (const [script, name] of [['main-steps.mjs', 'main'], ['control-steps.mjs', 'controls']]) {
  const record = path.join(scratch, name + (hosted ? '-hosted' : '') + '.json');
  await runScript(script, target, record);
  const got = JSON.parse(readFileSync(record, 'utf8')), referenceFile = path.join(here, 'reference', name + '.json');
  if (got.crashed) { console.log('WRONG ' + name + ' steps did not finish: ' + got.crashed.split('\n')[0]); failed = true; continue; }
  if (got.errors?.length) { console.log('WRONG ' + name + ': browser errors: ' + got.errors.join('; ')); failed = true; }
  if (update) { writeFileSync(referenceFile, JSON.stringify({what: 'What the accepted viewer does at each step of the walkthrough. Written by run.mjs --update-reference.', steps: got.steps}, null, 1) + '\n'); console.log('recorded ' + name + ' as the new reference'); continue; }
  const found = differences(JSON.parse(readFileSync(referenceFile, 'utf8')).steps, got.steps);
  console.log((found.length ? 'WRONG ' : 'ok    ') + name + ': ' + Object.keys(got.steps).length + ' steps, ' + found.length + ' differences from the reference');
  for (const line of found.slice(0, 15)) console.log('        ' + line);
  if (found.length) failed = true;
}
if (!update && await runScript('list-steps.mjs', target, view) !== 0) failed = true;
if (!update && await runScript('exterior-steps.mjs', target) !== 0) failed = true;
if (!hosted && !update) {
  if (await runScript('broken-files.mjs', view, path.join(scratch, 'broken-view')) !== 0) failed = true;
}
server?.close();
console.log(failed ? '\nThe viewer does not behave as the reference says.' : '\nThe viewer behaves as the reference says (' + (hosted ? 'served from a subfolder' : 'opened from disk') + ').');
process.exitCode = failed ? 1 : 0;
