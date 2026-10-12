// How the viewer's source is put together. The controllers are given what they use and never
// import the core or each other, so nothing in viewer/ depends on a module that depends on it.
import './test_setup.mjs';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

const folder = 'viewer', files = readdirSync(folder).filter(n => /\.(mjs|js)$/.test(n));
const imports = Object.fromEntries(files.map(file => [file, [...readFileSync(path.join(folder, file), 'utf8').matchAll(/^import .*? from "\.\/([^"]+)";/gm)].map(m => m[1])]));

const controllers = {'app-labels.mjs': 'createLabels', 'app-camera.mjs': 'createCamera', 'app-packages.mjs': 'createPackages', 'app-transport.mjs': 'createTransport',
  'app-views.mjs': 'createViews', 'app-inspect.mjs': 'createInspect', 'app-tour.mjs': 'createTour', 'app-master-list.mjs': 'createMasterList'};
for (const [file, factory] of Object.entries(controllers)) {
  const source = readFileSync(path.join(folder, file), 'utf8');
  assert(source.includes('export function ' + factory + '({'), file + ' exports ' + factory + ' and names its dependencies');
  for (const other of imports[file]) assert(!other.startsWith('app'), file + ' must not import ' + other + '; pass what it needs to ' + factory);
}
assert.deepEqual(imports['app.js'].filter(f => f.startsWith('app')), ['app-core.mjs'], 'the page wiring reaches the controllers through the core');

// No cycles anywhere.
const state = {};
function visit(file, trail) {
  if (state[file] === 'done') return;
  assert(state[file] !== 'open', 'import cycle: ' + [...trail, file].join(' → '));
  state[file] = 'open';
  for (const next of imports[file] || []) visit(next, [...trail, file]);
  state[file] = 'done';
}
for (const file of files) visit(file, []);
console.log('Viewer modules:', files.length, 'files, no import cycles;', Object.keys(controllers).length, 'controllers with explicit dependencies');
