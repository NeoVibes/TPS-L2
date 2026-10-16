import assert from 'node:assert/strict';
import {findBlender, blenderCandidates} from '../tools/blender.mjs';

const valid = version => ({status: 0, stdout: 'Blender ' + version + '\n'});
const attempts = [];
const found = await findBlender({env: {}, candidates: ['old', 'current'], exists: async () => true,
  probe: file => { attempts.push(file); return valid(file === 'old' ? '4.3.2' : '5.2.1'); }});
assert.deepEqual(found, {executable: 'current', version: '5.2.1'});
assert.deepEqual(attempts, ['old', 'current']);

// Missing, unlaunchable, malformed, failing and old candidates must all permit a later one.
const responses = {broken: {error: Error('permission denied')}, malformed: {status: 0, stdout: 'not Blender'},
  failed: {status: 2, stdout: 'Blender 5.2.1'}, old: valid('5.1.9'), current: valid('5.2.0')};
const tried = [];
assert.deepEqual(await findBlender({env: {}, candidates: ['missing', 'broken', 'malformed', 'failed', 'old', 'old', 'throws', 'current'],
  exists: file => file !== 'missing', probe: file => { tried.push(file); if (file === 'throws') throw Error('cannot execute'); return responses[file]; }}),
{executable: 'current', version: '5.2.0'});
assert.deepEqual(tried, ['broken', 'malformed', 'failed', 'old', 'throws', 'current']);

for (const explicit of ['missing', 'broken', 'malformed', 'failed', 'old', 'throws']) {
  const probed = [];
  await assert.rejects(findBlender({env: {BLENDER_BIN: explicit}, candidates: ['current'],
    exists: file => file !== 'missing', probe: file => { probed.push(file); if (file === 'throws') throw Error('cannot execute'); return responses[file]; }}),
  error => error.message.includes('Fix BLENDER_BIN') && error.message.includes(explicit));
  assert(!probed.includes('current'), 'An explicit installation must never silently fall back');
}
assert.deepEqual(await findBlender({env: {BLENDER_BIN: 'chosen'}, candidates: ['current'], exists: () => true, probe: () => valid('5.2.1')}),
  {executable: 'chosen', version: '5.2.1'});
await assert.rejects(findBlender({env: {}, candidates: ['old', 'malformed'], exists: () => true, probe: file => responses[file]}),
  error => error.message.includes('old: Blender 5.1.9 is too old') && error.message.includes('malformed: version probe'));

const notes = [];
assert.equal((await findBlender({env: {}, candidates: ['future'], exists: () => true, probe: () => valid('6.0.0'), note: text => notes.push(text)})).version, '6.0.0');
assert.match(notes[0], /tested with 5\.2/);
assert.deepEqual(await blenderCandidates({platform: 'linux', env: {PATH: '/one:/two:/one'}}), ['/one/blender', '/two/blender']);
assert.deepEqual(await blenderCandidates({platform: 'darwin', env: {PATH: '/one', HOME: '/people/example'}}),
  ['/one/blender', '/Applications/Blender.app/Contents/MacOS/Blender', '/people/example/Applications/Blender.app/Contents/MacOS/Blender']);
assert.deepEqual(await blenderCandidates({platform: 'win32', env: {PATH: 'C:\\one;D:\\two', ProgramFiles: 'C:\\Programs'}, readDirectory: async () => ['Blender 5.2', 'Blender 4.3']}),
  ['C:\\one\\blender.exe', 'D:\\two\\blender.exe', 'C:\\Programs\\Blender Foundation\\Blender 5.2\\blender.exe', 'C:\\Programs\\Blender Foundation\\Blender 4.3\\blender.exe']);
console.log('Blender discovery: candidate fallthrough, explicit override, diagnostics and platform locations pass.');
