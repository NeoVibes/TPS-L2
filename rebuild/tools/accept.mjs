// npm run accept   Records the current build as the accepted state of the model.
//
// Run it after you have looked at what "npm run build" or "npm test" says changed and it is what
// you meant. It refuses a kit that breaks the rules or a view/ that is out of date.
//
// It also ties each new assessment in edit/assessments.json to the model as it is now: the "bound_to"
// block holds fingerprints of the parts involved and of the target's definition. If one of them changes
// later, the assessment stops counting. To accept it again after reviewing it, delete its "bound_to"
// block and run this command.
import {readFile, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {ROOT, VIEW, ASSESSMENTS, json} from './integrity.mjs';
import {checkKit} from './check.mjs';
import {fingerprintView, readView} from './compare.mjs';
import {confirmation, bindingFor} from './confirmation.mjs';

const stopIfBroken = async () => {
  const {errors, warnings, facts} = await checkKit();
  if (!errors.length && !facts.out_of_date?.length) return;
  for (const line of [...errors, ...warnings]) console.error(line);
  console.error('Nothing was accepted. Fix the above, run npm run build, then accept.');
  process.exit(1);
};
await stopIfBroken();

// New assessments: tie them to the model, then rebuild the lists so the levels in view/ include them.
const file = await json(ASSESSMENTS), unbound = file.assessments.filter(a => !a.bound_to);
if (unbound.length) {
  const state = await confirmation(await readView(VIEW), '');
  for (const assessment of unbound) assessment.bound_to = bindingFor(assessment, state);
  await writeFile(path.join(ROOT, ASSESSMENTS), JSON.stringify(file, null, 1) + '\n');
  console.log('Tied ' + unbound.length + ' new assessment' + (unbound.length === 1 ? '' : 's') + ' to the current model: ' + unbound.map(a => a.id).join(', ') + '.');
  const rebuild = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--viewer'], {cwd: ROOT, stdio: 'inherit'});
  if (rebuild.status !== 0) { console.error('The lists could not be rebuilt, so nothing was accepted.'); process.exit(1); }
  await stopIfBroken();
}

const state = await fingerprintView(VIEW);
await writeFile(path.join(ROOT, 'accepted.json'), JSON.stringify({what: 'The accepted state of the model: one fingerprint per part, each target\'s definition and outcome, and any confirmation level above 1. Written by "npm run accept".', ...state}, null, 1) + '\n');
const levels = JSON.parse(await readFile(path.join(VIEW, 'assessment-results.json'), 'utf8')).rows_at_each_level;
console.log('Accepted the current build: ' + Object.keys(state.parts).length + ' fingerprints (parts and their variants) recorded in rebuild/accepted.json. Rows at each confirmation level: ' + Object.entries(levels).map(([l, n]) => l + ': ' + n).join(', ') + '.');
