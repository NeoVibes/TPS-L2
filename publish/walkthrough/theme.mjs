// Theme checks on the shipped viewer, its own controls and its actual WebGL output. Run by run.mjs through checks.mjs.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {inflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const axeSource = readFileSync(path.join(kit, 'rebuild/node_modules/axe-core/axe.min.js'), 'utf8');
const storageKey = 'tpsl2-theme';

// Decodes a screenshot PNG (8-bit RGB or RGBA, not interlaced, as Chrome writes them) to raw pixels.
function decodePng(buffer) {
  let pos = 8, width, height, channels; const idat = [];
  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos), type = buffer.toString('latin1', pos + 4, pos + 8), data = buffer.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = {2: 3, 6: 4}[data[9]]; if (data[8] !== 8 || !channels || data[12]) throw Error('Unsupported PNG'); }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * channels, pixels = Buffer.alloc(stride * height);
  for (let r = 0; r < height; r++) {
    const filter = raw[r * (stride + 1)], src = raw.subarray(r * (stride + 1) + 1), line = pixels.subarray(r * stride, (r + 1) * stride), prev = r ? pixels.subarray((r - 1) * stride, r * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0, b = prev ? prev[i] : 0, c = prev && i >= channels ? prev[i - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      line[i] = (src[i] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]) & 255;
    }
  }
  return {width, height, channels, pixels};
}

const palette = page => page.call(() => ({
  resolved: getComputedStyle(document.documentElement).getPropertyValue('--theme-resolved').trim(),
  override: document.documentElement.getAttribute('data-theme'),
  choice: document.getElementById('theme-select')?.value,
  background: getComputedStyle(document.body).backgroundColor,
}));
async function assertTheme(page, resolved, choice) {
  const current = await palette(page);
  const rgba = current.background.match(/[\d.]+/g).map(Number);
  assert.equal(rgba[3] ?? 1, 1, 'The page palette must be opaque; transparent black is not a dark theme');
  const channels = rgba.slice(0, 3);
  assert(resolved === 'dark' ? Math.max(...channels) < 90 : Math.min(...channels) > 210, 'The actual page background must use the resolved light/dark palette');
  assert.equal(current.resolved, resolved, 'The CSS must resolve the requested theme');
  assert.equal(current.choice, choice, 'The visible theme choice must agree');
  assert.equal(current.override, choice === 'system' ? null : choice, 'System must leave no explicit HTML override');
  return current;
}
async function contrast(page, record, label) {
  // The pinned local axe-core source goes in through the debugging connection: no network, no CSP change.
  if (!await page.evaluate('Boolean(window.axe)')) await page.evaluate(axeSource + ';true');
  const result = await page.evaluate(`(async()=>{const result=await window.axe.run(document,{runOnly:{type:'rule',values:['color-contrast']}});
    const compact=list=>list.map(rule=>({id:rule.id,nodes:rule.nodes.map(node=>({target:node.target,summary:node.failureSummary,checks:[...node.any,...node.all,...node.none].map(c=>({id:c.id,data:c.data}))}))}));
    return {version:result.testEngine.version,violations:compact(result.violations),incomplete:compact(result.incomplete),passes:result.passes.length}})()`);
  record.contrast.push({label, ...result});
  assert.equal(result.version, '4.14.0');
  assert.deepEqual(result.violations, [], label + ': text and control-label contrast');
}

// Geometry is really held back, from disk and over HTTP, so the loading frame is observable.
export async function themeStartup({browser, url, record, output}) {
  record.theme = {startup: [], contrast: [], canvas: [], screenshots: [], manualReview: ['Canvas labels and selection highlights require visual review; axe incomplete results are retained.']};
  const cases = [
    {name: 'system-light', os: 'light', resolved: 'light', choice: 'system'},
    {name: 'system-dark', os: 'dark', resolved: 'dark', choice: 'system'},
    {name: 'saved-light', os: 'dark', stored: 'light', resolved: 'light', choice: 'light'},
    {name: 'saved-dark', os: 'light', stored: 'dark', resolved: 'dark', choice: 'dark'},
    {name: 'invalid-choice', os: 'dark', stored: 'invalid', resolved: 'dark', choice: 'system'},
    {name: 'storage-denied', os: 'dark', denied: true, resolved: 'dark', choice: 'system'},
    {name: 'storage-write-denied', os: 'dark', writeDenied: true, resolved: 'dark', choice: 'system'},
  ];
  for (const test of cases) {
    record.phase = 'theme-startup-' + test.name;
    const init = `(${({stored, denied, writeDenied, key}) => {
      if (denied) Object.defineProperty(window, 'localStorage', {get() { throw new DOMException('Test storage denial', 'SecurityError'); }});
      else if (stored) localStorage.setItem(key, stored);
      if (writeDenied) for (const method of ['setItem', 'removeItem']) Storage.prototype[method] = () => { throw new DOMException('Test write denial', 'QuotaExceededError'); };
      const firstFrame = () => {
        if (!document.body) { requestAnimationFrame(firstFrame); return; }
        window.__themeFirstFrame = {background: getComputedStyle(document.body).backgroundColor,
          resolved: getComputedStyle(document.documentElement).getPropertyValue('--theme-resolved').trim(), override: document.documentElement.getAttribute('data-theme')};
      };
      requestAnimationFrame(firstFrame);
    }})(${JSON.stringify({...test, key: storageKey})})`;
    const context = await browser.context();
    let release; const gate = new Promise(r => { release = r; });
    try {
      const page = await context.page({width: 1400, height: 900, colorScheme: test.os, reducedMotion: 'reduce', init: [init]});
      let intercepted = false;
      await page.route('/geometry/exterior.js', r => { intercepted = true; gate.then(() => r.continue()); });
      await page.goto(url, {until: 'domcontentloaded'});
      await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))');
      assert(intercepted, 'The real geometry request must be delayed');
      assert.equal(await page.evaluate('Boolean(window.portableTapePlayer?.snapshot().ready)'), false);
      assert(await page.visible('#loading'), 'First paint must still be the loading screen');
      const first = await assertTheme(page, test.resolved, test.choice);
      const earliest = await page.evaluate('window.__themeFirstFrame');
      assert.deepEqual(earliest, {background: first.background, resolved: first.resolved, override: first.override}, 'The earliest body animation frame must already have the requested palette');
      if (test.name === 'system-dark' || test.name === 'saved-light') await contrast(page, record.theme, 'loading-' + test.resolved);
      await page.media({colorScheme: test.os === 'dark' ? 'light' : 'dark'});
      await assertTheme(page, test.choice === 'system' ? (test.os === 'dark' ? 'light' : 'dark') : test.choice, test.choice);
      if (test.denied || test.writeDenied) {
        await page.select('#theme-select', 'dark'); await assertTheme(page, 'dark', 'dark');
        await page.select('#theme-select', 'system'); await assertTheme(page, 'light', 'system');
      }
      if (test.name === 'system-dark') {
        await page.select('#theme-select', 'dark'); await page.reload({until: 'domcontentloaded'}); await assertTheme(page, 'dark', 'dark');
        await page.select('#theme-select', 'system'); await page.reload({until: 'domcontentloaded'}); await assertTheme(page, 'light', 'system');
        record.theme.reloadPersistence = true;
      }
      assert.deepEqual(page.log.errors, [], 'Theme startup and storage failures must not throw');
      record.theme.startup.push({case: test.name, first, earliest, geometryDelayed: true, preferenceChange: true, storageDenied: Boolean(test.denied || test.writeDenied)});
    } finally { release(); await context.close(); }
  }
  // A genuine failed geometry load exercises the shipped error screen in both palettes.
  for (const resolved of ['light', 'dark']) {
    record.phase = 'theme-loading-error-' + resolved;
    const context = await browser.context();
    try {
      const page = await context.page({width: 1400, height: 900, colorScheme: resolved});
      await page.route('/geometry/exterior.js', r => r.fail());
      await page.goto(url, {until: 'domcontentloaded'});
      await page.waitFor('window.portableTapePlayerError', 30);
      await assertTheme(page, resolved, 'system');
      assert(await page.visible('#loadingRetry'), 'The actual load error must offer recovery');
      await contrast(page, record.theme, 'loading-error-' + resolved);
      const screenshot = `${record.protocol}-theme-error-${resolved}.png`;
      await page.screenshot(path.join(output, screenshot)); record.theme.screenshots.push(screenshot);
    } finally { await context.close(); }
  }
}

async function canvasColor(page, record, label) {
  const expected = await page.call(() => {
    const stage = document.getElementById('stage'), color = getComputedStyle(stage).getPropertyValue('--stage-backdrop').trim();
    const probe = document.createElement('span'); probe.style.color = color; stage.append(probe);
    const rgb = getComputedStyle(probe).color.match(/[\d.]+/g).slice(0, 3).map(Number); probe.remove();
    return {color, rgb};
  });
  const rect = await page.call(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return {x: r.left, y: r.top, width: r.width, height: r.height}; });
  const png = decodePng(await page.screenshot(null, {clip: rect}));
  // The lower-left clear corner avoids camera tools, status text and the inspector.
  const index = ((png.height - 8) * png.width + 8) * png.channels;
  const actual = [...png.pixels.subarray(index, index + 3)];
  record.canvas.push({label, expected, actual});
  assert(actual.every((channel, i) => Math.abs(channel - expected.rgb[i]) <= 2), label + ': actual color-managed canvas backdrop must match CSS (' + actual + ' vs ' + expected.rgb + ')');
}
const invariant = page => page.evaluate(`(()=>{const s=window.portableTapePlayer.snapshot({appearance:true});return {state:s.state,parts:s.parts,appearanceInvariant:s.appearanceInvariant,frames:s.renderedFrames}})()`);
async function selectExt030(page) {
  await page.press('[data-workmode="inspect"]');
  if (!await page.evaluate(`document.getElementById('catalog').open`)) await page.press('#catalog > summary');
  await page.fill('#search', 'EXT-030'); await page.press('#results .part-result', {text: '^EXT-030 ·'});
  await page.press('#homeCamera');
}

// axe uses timers of its own, so the accessibility scan runs before the application clock is frozen.
export async function themeAccessibility({page, record, output}) {
  record.phase = 'theme-accessibility';
  await selectExt030(page);
  await page.waitFor(`['exterior','mechanism','electronics','cassette'].every(n=>window.portableTapePlayer.snapshot().loaded.includes(n))`, 60);
  for (const theme of ['light', 'dark']) {
    await page.select('#theme-select', theme);
    await assertTheme(page, theme, theme);
    assert.equal((await invariant(page)).state.selectedId, 'EXT-030');
    await contrast(page, record.theme, theme + '-selected');
    const screenshot = `${record.protocol}-theme-${theme}-selected.png`;
    await page.screenshot(path.join(output, screenshot)); record.theme.screenshots.push(screenshot);
    await page.viewport(390, 844);
    await page.focus('#theme-select'); await page.key('Tab'); await page.key('Shift+Tab');
    const focus = await page.call(() => {
      const node = document.getElementById('theme-select'), r = node.getBoundingClientRect(), s = getComputedStyle(node);
      return {focused: node === document.activeElement, visible: node.matches(':focus-visible'), outline: s.outlineStyle, width: parseFloat(s.outlineWidth),
        left: r.left, right: r.right, viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1};
    });
    assert(focus.focused && focus.visible && focus.outline !== 'none' && focus.width >= 2, 'Theme control needs a visible keyboard focus ring ' + JSON.stringify(focus));
    assert(focus.left >= 0 && focus.right <= focus.viewport && !focus.overflow, 'Narrow controls must fit without horizontal page overflow');
    await contrast(page, record.theme, theme + '-narrow');
    const narrow = `${record.protocol}-theme-${theme}-narrow.png`;
    await page.screenshot(path.join(output, narrow), {fullPage: true}); record.theme.screenshots.push(narrow);
    await page.viewport(1400, 900);
  }
  await page.press('#reset');
}

// Runs after the interruption checks have frozen the application clock.
export async function themeRuntime({page, record, output, advanceFrame}) {
  record.phase = 'theme-state-preservation';
  await page.press('#reset');
  await selectExt030(page);
  await page.focus('#canvas'); await page.key('ArrowRight');
  await page.focus('#tapePosition'); await page.key('Home');
  for (let i = 0; i < 5; i++) await page.key('PageUp');
  await page.focus('#volumeLeft'); await page.key('End');
  await page.focus('#volumeRight'); await page.key('Home');
  await page.select('#tone', 'low');
  await page.press('#audioEnable');
  await page.press('[data-mode="play"]');
  await advanceFrame(page, record, 'Theme invariant baseline', 32);
  // The application clock is frozen, but loading and decoding the recording are
  // asynchronous. At mid-side the recording has ended and the tape plays silently.
  await page.waitFor(`(()=>{const {audio}=window.portableTapePlayer.snapshot();return audio.music.loaded && audio.state==='ready' && !audio.music.playing})()`, 60);
  const before = await invariant(page);
  assert(before.state.selectedId, 'The invariant comparison must preserve a selected part');
  assert.equal(before.state.mode, 'play'); assert(before.state.tapePosition > .4 && before.state.tapePosition < .6);
  assert.equal(before.state.audioEnabled, true);
  assert(before.appearanceInvariant, 'The snapshot must include actual camera/material/light/renderer/audio values');
  writeFileSync(path.join(output, `${record.protocol}-theme-invariant.json`), JSON.stringify(before, null, 2) + '\n');
  for (const theme of ['dark', 'light', 'system']) {
    await page.select('#theme-select', theme);
    assert.deepEqual(await invariant(page), before, theme + ': switching theme must preserve the entire frozen viewer state');
  }
  record.theme.statePreserved = {selected: before.state.selectedId, mode: before.state.mode, tape: before.state.tapePosition, audioEnabled: before.state.audioEnabled, sameFrames: true};
  // Preferences change the backdrop at once but never the camera or model state.
  await page.media({colorScheme: 'dark'}); await assertTheme(page, 'dark', 'system'); assert.deepEqual(await invariant(page), before);
  await page.media({colorScheme: 'light'}); await assertTheme(page, 'light', 'system'); assert.deepEqual(await invariant(page), before);
  await page.select('#theme-select', 'dark');
  assert.equal(await page.call(key => localStorage.getItem(key), storageKey), 'dark');
  await page.press('#reset'); await assertTheme(page, 'dark', 'dark');
  record.theme.resetPreserved = true;
  for (const kind of ['stop', 'eject']) {
    await page.press('#reset'); await page.press('#door');
    if (kind === 'stop') await page.press('[data-mode="play"]');
    await page.press('#eject');
    await advanceFrame(page, record, 'Theme during pending ' + kind, 32);
    const pending = await invariant(page);
    assert(pending.state.stopTravel > 0 && pending.state.stopTravel < 1);
    assert.equal(pending.appearanceInvariant.pending.stopCycle.kind, kind);
    for (const theme of ['light', 'dark', 'system']) {
      await page.select('#theme-select', theme);
      assert.deepEqual(await invariant(page), pending, 'Theme must preserve pending ' + kind + ' without advancing time');
    }
  }
  record.theme.pendingCyclesPreserved = ['stop', 'eject'];
  await page.press('#reset');
  for (const theme of ['light', 'dark']) {
    await page.select('#theme-select', theme);
    const colors = [];
    for (const view of ['assembled', 'service', 'exploded', 'catalog']) {
      await page.press(`button[data-view="${view}"]`);
      await advanceFrame(page, record, `${theme} ${view} backdrop`, 32);
      await canvasColor(page, record.theme, theme + '-' + view);
      colors.push(record.theme.canvas.at(-1).expected.color);
      if (view === 'exploded' || view === 'catalog') {
        const screenshot = `${record.protocol}-theme-${theme}-${view}.png`;
        await page.screenshot(path.join(output, screenshot)); record.theme.screenshots.push(screenshot);
      }
    }
    assert.notEqual(colors[0], colors[1], 'Assembled and separated backdrops must remain distinct');
  }
  await page.select('#theme-select', 'system');
  assert.equal(await page.call(key => localStorage.getItem(key), storageKey), null, 'System must remove the stored override');
  await page.press('#reset');
  await advanceFrame(page, record, 'Theme suite final reset', 32);
  await page.select('#theme-select', 'dark');
  await advanceFrame(page, record, 'Dark assembled preview', 32);
  const preview = `${record.protocol}-theme-dark-assembled.png`;
  await page.screenshot(path.join(output, preview)); record.theme.screenshots.push(preview);
  record.theme.passed = true;
}
