import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createTheme, THEME_STORAGE_KEY} from '../viewer/app-theme.mjs';
import {createOperatingState, resetOperating} from '../viewer/operating-state.mjs';

const bootstrap = await readFile(new URL('../viewer/theme-init.js', import.meta.url), 'utf8');
const makeRoot = (initial = null) => {
  const attributes = new Map(initial === null ? [] : [['data-theme', initial]]);
  return {getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)), removeAttribute: name => attributes.delete(name)};
};
function bootstrapWith(storage, initial = null) {
  const root = makeRoot(initial), context = {document: {documentElement: root}};
  Object.defineProperty(context, 'localStorage', {get: storage});
  runInNewContext(bootstrap, context);
  return root;
}
for (const stored of [null, 'system', 'invalid', 'Dark', 'light', 'dark']) {
  const root = bootstrapWith(() => ({getItem(key) { assert.equal(key, THEME_STORAGE_KEY); return stored; }}), 'dark');
  assert.equal(root.getAttribute('data-theme'), ['light', 'dark'].includes(stored) ? stored : null);
}
for (const storage of [() => { throw Error('storage getter denied'); }, () => ({getItem() { throw Error('storage read denied'); }})])
  assert.equal(bootstrapWith(storage, 'dark').getAttribute('data-theme'), null, 'Bootstrap storage errors fall back to CSS System');

function fixture({stored = null, dark = false, storageError = null} = {}) {
  const values = new Map(stored === null ? [] : [[THEME_STORAGE_KEY, stored]]), writes = [], notifications = [];
  const storage = () => {
    if (storageError === 'get') throw Error('storage getter denied');
    return {
      getItem: key => values.get(key) ?? null,
      setItem(key, value) { if (storageError === 'set') throw Error('quota denied'); writes.push(['set', key, value]); values.set(key, value); },
      removeItem(key) { if (storageError === 'remove') throw Error('storage remove denied'); writes.push(['remove', key]); values.delete(key); },
    };
  };
  const root = bootstrapWith(storage), select = new EventTarget(), media = new EventTarget();
  select.value = ''; media.matches = dark;
  const theme = createTheme({root, select, media, storage, onChange: change => notifications.push(change)});
  const choose = value => { select.value = value; select.dispatchEvent(new Event('change')); };
  const system = value => { media.matches = value; media.dispatchEvent(new Event('change')); };
  return {theme, root, select, media, values, writes, notifications, choose, system};
}

for (const dark of [false, true]) {
  const f = fixture({dark});
  assert.equal(f.theme.preference, 'system'); assert.equal(f.select.value, 'system');
  assert.equal(f.theme.resolved, dark ? 'dark' : 'light'); assert.equal(f.root.getAttribute('data-theme'), null);
  assert.deepEqual(f.notifications, [{preference: 'system', resolved: dark ? 'dark' : 'light'}]);
  assert.deepEqual(f.writes, [], 'Initialization must not persist an OS-derived preference');
  f.system(!dark);
  assert.equal(f.theme.resolved, dark ? 'light' : 'dark'); assert.equal(f.notifications.length, 2);
  assert.equal(f.root.getAttribute('data-theme'), null, 'System never becomes an explicit attribute');
  f.system(!dark); assert.equal(f.notifications.length, 2, 'Duplicate media notifications need no redraw');
  f.theme.dispose();
}

for (const stored of ['light', 'dark']) {
  const f = fixture({stored, dark: stored === 'light'});
  assert.equal(f.theme.preference, stored); assert.equal(f.theme.resolved, stored); assert.equal(f.select.value, stored);
  f.system(stored === 'dark'); f.system(stored === 'light');
  assert.equal(f.notifications.length, 1, 'System changes do not override an explicit preference');
  const next = stored === 'light' ? 'dark' : 'light'; f.choose(next);
  assert.equal(f.theme.resolved, next); assert.equal(f.root.getAttribute('data-theme'), next);
  assert.equal(f.values.get(THEME_STORAGE_KEY), next);
  f.choose('system');
  assert.equal(f.root.getAttribute('data-theme'), null); assert(!f.values.has(THEME_STORAGE_KEY));
  assert.equal(f.theme.resolved, f.media.matches ? 'dark' : 'light');
  f.theme.dispose();
}

for (const storageError of ['get', 'set', 'remove']) {
  const f = fixture({storageError});
  f.choose('dark'); assert.equal(f.theme.preference, 'dark'); assert.equal(f.root.getAttribute('data-theme'), 'dark');
  f.choose('system'); assert.equal(f.theme.preference, 'system'); assert.equal(f.root.getAttribute('data-theme'), null);
  f.system(true); assert.equal(f.theme.resolved, 'dark');
  assert.equal(f.notifications.at(-1).resolved, 'dark');
  f.theme.dispose();
}

const f = fixture();
const operating = createOperatingState({speed: 1});
operating.mode = 'play'; operating.tapePosition = .42;
const before = structuredClone(operating);
f.choose('dark'); assert.deepEqual(operating, before, 'Theme changes do not mutate operating state');
resetOperating(operating);
assert.equal(f.theme.preference, 'dark'); assert.equal(f.select.value, 'dark');
assert.equal(f.root.getAttribute('data-theme'), 'dark'); assert.equal(f.values.get(THEME_STORAGE_KEY), 'dark');
f.choose('unexpected'); assert.equal(f.select.value, 'system'); assert.equal(f.root.getAttribute('data-theme'), null);
f.choose('light'); const count = f.notifications.length;
f.theme.dispose(); f.choose('dark'); f.system(true);
assert.equal(f.theme.preference, 'light'); assert.equal(f.root.getAttribute('data-theme'), 'light');
assert.equal(f.notifications.length, count, 'Disposal removes both event listeners');
console.log('Theme: first-paint override, System changes, explicit choices, storage failures and operating-reset separation pass.');
