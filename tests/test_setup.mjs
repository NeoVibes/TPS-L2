// Imported first by every test. Runs the test from rebuild/ and hands the viewer modules the
// same data the page gets from view/geometry/model.js.
import {mkdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {ROOT, VIEW, requireNode} from '../tools/integrity.mjs';

requireNode();
process.chdir(ROOT);
mkdirSync('build/test-results', {recursive: true});

const text = readFileSync(path.join(VIEW, 'geometry/model.js'), 'utf8');
globalThis.portableTapePlayerData = {model: JSON.parse(text.slice(text.indexOf(',') + 1, text.lastIndexOf(')')))};
