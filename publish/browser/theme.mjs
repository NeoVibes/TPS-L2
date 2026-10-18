// Theme acceptance uses the shipped viewer, native controls and actual WebGL output.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {PNG} from 'pngjs';

const axeSource = await readFile(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const storageKey = 'tpsl2-theme';
async function bounded(label, operation) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(label + ' exceeded 60000ms')), 60000);
  })]); } finally { clearTimeout(timer); }
}
const palette = page => page.evaluate(() => ({
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
  assert(resolved === 'dark' ? Math.max(...channels) < 90 : Math.min(...channels) > 210,
    'The actual page background must use the resolved light/dark palette');
  assert.equal(current.resolved, resolved, 'The CSS must resolve the requested theme');
  assert.equal(current.choice, choice, 'The visible theme choice must agree');
  assert.equal(current.override, choice === 'system' ? null : choice, 'System must leave no explicit HTML override');
  return current;
}
async function contrast(page, record, label) {
  // Inject the pinned local source through the automation API; no network or CSP relaxation.
  if (!await page.evaluate(() => Boolean(window.axe))) await page.evaluate(axeSource);
  const result = await bounded('axe contrast scan', page.evaluate(async () => {
    const result = await window.axe.run(document, {runOnly: {type: 'rule', values: ['color-contrast']}});
    const compact = list => list.map(rule => ({id: rule.id, nodes: rule.nodes.map(node => ({target: node.target,
      summary: node.failureSummary, checks: [...node.any, ...node.all, ...node.none].map(check => ({id: check.id, data: check.data}))}))}));
    return {version: result.testEngine.version, violations: compact(result.violations), incomplete: compact(result.incomplete), passes: result.passes.length};
  }));
  record.contrast.push({label, ...result});
  assert.equal(result.version, '4.14.0');
  assert.deepEqual(result.violations, [], label + ': text and control-label contrast');
}

/** Geometry is really held back in both file:// and HTTP, so the loading frame is observable. */
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
    const context = await browser.newContext({colorScheme: test.os, viewport: {width: 1400, height: 900}, reducedMotion: 'reduce'});
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    try {
      await context.addInitScript(({stored, denied, writeDenied, key}) => {
        if (denied) Object.defineProperty(window, 'localStorage', {get() {throw new DOMException('Test storage denial', 'SecurityError');}});
        else if (stored) localStorage.setItem(key, stored);
        if (writeDenied) for (const method of ['setItem', 'removeItem']) Storage.prototype[method] = () => {throw new DOMException('Test write denial', 'QuotaExceededError');};
        const firstFrame = () => {
          if (!document.body) {requestAnimationFrame(firstFrame); return;}
          window.__themeFirstFrame = {background: getComputedStyle(document.body).backgroundColor,
            resolved: getComputedStyle(document.documentElement).getPropertyValue('--theme-resolved').trim(),
            override: document.documentElement.getAttribute('data-theme')};
        };
        requestAnimationFrame(firstFrame);
      }, {...test, key: storageKey});
      const page = await context.newPage();
      const pageErrors = []; page.on('pageerror', error => pageErrors.push(String(error)));
      let intercepted = false;
      await page.route('**/geometry/exterior.js', async route => {
        intercepted = true; await gate; await route.continue().catch(() => {});
      });
      await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 60000});
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert(intercepted, 'The real geometry request must be delayed');
      assert.equal(await page.evaluate(() => Boolean(window.portableTapePlayer?.snapshot().ready)), false);
      assert(await page.locator('#loading').isVisible(), 'First paint must still be the loading screen');
      const first = await assertTheme(page, test.resolved, test.choice);
      const earliest = await page.evaluate(() => window.__themeFirstFrame);
      assert.deepEqual(earliest, {background: first.background, resolved: first.resolved, override: first.override},
        'The earliest body animation frame must already have the requested palette');
      // Keep geometry held for every loading assertion. A diagnostic screenshot here would
      // wait for document.fonts.ready in Playwright, which WebKit resolves only after load
      // (including the held script). The real earliest-frame values above are the evidence;
      // error-state and fully loaded viewer screenshots are captured separately below.
      if (test.name === 'system-dark' || test.name === 'saved-light') await contrast(page, record.theme, 'loading-' + test.resolved);
      await page.emulateMedia({colorScheme: test.os === 'dark' ? 'light' : 'dark'});
      await assertTheme(page, test.choice === 'system' ? (test.os === 'dark' ? 'light' : 'dark') : test.choice, test.choice);
      if (test.denied || test.writeDenied) {
        await page.locator('#theme-select').selectOption('dark');
        await assertTheme(page, 'dark', 'dark');
        await page.locator('#theme-select').selectOption('system');
        await assertTheme(page, 'light', 'system');
      }
      if (test.name === 'system-dark') {
        await page.locator('#theme-select').selectOption('dark');
        await page.reload({waitUntil: 'domcontentloaded', timeout: 60000});
        await assertTheme(page, 'dark', 'dark');
        await page.locator('#theme-select').selectOption('system');
        await page.reload({waitUntil: 'domcontentloaded', timeout: 60000});
        await assertTheme(page, 'light', 'system');
        record.theme.reloadPersistence = true;
      }
      assert.deepEqual(pageErrors, [], 'Theme startup and storage failures must not throw');
      record.theme.startup.push({case: test.name, first, earliest, geometryDelayed: true, preferenceChange: true,
        storageDenied: Boolean(test.denied || test.writeDenied), pageErrors});
    } finally { release(); await context.close(); }
  }
  // A genuine failed geometry load exercises the shipped error UI in both palettes.
  for (const resolved of ['light', 'dark']) {
    record.phase = 'theme-loading-error-' + resolved;
    const context = await browser.newContext({colorScheme: resolved, viewport: {width: 1400, height: 900}});
    try {
      const page = await context.newPage();
      await page.route('**/geometry/exterior.js', route => route.abort('failed'));
      await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 60000});
      await page.waitForFunction(() => window.portableTapePlayerError, null, {timeout: 30000});
      await assertTheme(page, resolved, 'system');
      assert(await page.locator('#loadingRetry').isVisible(), 'The actual load error must offer recovery');
      await contrast(page, record.theme, 'loading-error-' + resolved);
      const screenshot = `${record.browser}-${record.protocol}-theme-error-${resolved}.png`;
      await page.screenshot({path: path.join(output, screenshot)});
      record.theme.screenshots.push(screenshot);
    } finally { await context.close(); }
  }
}

async function canvasColor(page, record, label) {
  const expected = await page.locator('#stage').evaluate(stage => {
    const color = getComputedStyle(stage).getPropertyValue('--stage-backdrop').trim();
    const probe = document.createElement('span'); probe.style.color = color; stage.append(probe);
    const rgb = getComputedStyle(probe).color.match(/[\d.]+/g).slice(0, 3).map(Number); probe.remove();
    return {color, rgb};
  });
  const png = PNG.sync.read(await page.locator('#canvas').screenshot());
  // Lower-left clear corner avoids camera tools, status text and the inspector.
  const index = ((png.height - 8) * png.width + 8) * 4;
  const actual = [...png.data.subarray(index, index + 3)];
  record.canvas.push({label, expected, actual});
  assert(actual.every((channel, i) => Math.abs(channel - expected.rgb[i]) <= 2),
    label + ': actual color-managed canvas backdrop must match CSS (' + actual + ' vs ' + expected.rgb + ')');
}
const invariant = page => page.evaluate(() => {
  const s = window.portableTapePlayer.snapshot({appearance: true});
  return {state: s.state, parts: s.parts, appearanceInvariant: s.appearanceInvariant, frames: s.renderedFrames};
});

// axe uses timers internally, so DOM accessibility runs before the application clock is frozen.
export async function themeAccessibility({page, record, output}) {
  record.phase = 'theme-accessibility';
  await page.locator('[data-workmode="inspect"]').click();
  if (!await page.locator('#catalog').evaluate(node => node.open)) await page.locator('#catalog > summary').click();
  await page.locator('#search').fill('EXT-030'); await page.locator('#results .part-result').last().click();
  await page.locator('#homeCamera').click();
  await page.waitForFunction(() => ['exterior', 'mechanism', 'electronics', 'cassette'].every(name => window.portableTapePlayer.snapshot().loaded.includes(name)));
  for (const theme of ['light', 'dark']) {
    await page.locator('#theme-select').selectOption(theme);
    await assertTheme(page, theme, theme);
    assert.equal((await invariant(page)).state.selectedId, 'EXT-030');
    await contrast(page, record.theme, theme + '-selected');
    const screenshot = `${record.browser}-${record.protocol}-theme-${theme}-selected.png`;
    await page.screenshot({path: path.join(output, screenshot)}); record.theme.screenshots.push(screenshot);
    await page.setViewportSize({width: 390, height: 844});
    await page.locator('#theme-select').focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    const focus = await page.locator('#theme-select').evaluate(node => {
      const r = node.getBoundingClientRect(), s = getComputedStyle(node);
      return {focused: node === document.activeElement, visible: node.matches(':focus-visible'), outline: s.outlineStyle,
        width: parseFloat(s.outlineWidth), left: r.left, right: r.right, viewport: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth + 1};
    });
    assert(focus.focused && focus.visible && focus.outline !== 'none' && focus.width >= 2, 'Theme control needs a visible keyboard focus ring');
    assert(focus.left >= 0 && focus.right <= focus.viewport && !focus.overflow, 'Narrow controls must fit without horizontal page overflow');
    await contrast(page, record.theme, theme + '-narrow');
    const narrow = `${record.browser}-${record.protocol}-theme-${theme}-narrow.png`;
    await page.screenshot({path: path.join(output, narrow), fullPage: true}); record.theme.screenshots.push(narrow);
    await page.setViewportSize({width: 1400, height: 900});
  }
  await page.locator('#reset').click();
}

/** Runs after the existing interruption fixture has frozen application animation. */
export async function themeRuntime({page, record, output, advanceFrame}) {
  record.phase = 'theme-state-preservation';
  await page.locator('#reset').click();
  await page.locator('[data-workmode="inspect"]').click();
  if (!await page.locator('#catalog').evaluate(node => node.open)) await page.locator('#catalog > summary').click();
  await page.locator('#search').fill('EXT-030');
  await page.locator('#results .part-result').last().click();
  await page.locator('#homeCamera').click();
  await page.locator('#canvas').focus(); await page.keyboard.press('ArrowRight');
  await page.locator('#tapePosition').focus(); await page.keyboard.press('Home');
  for (let i = 0; i < 5; i++) await page.keyboard.press('PageUp');
  await page.locator('#volumeLeft').focus(); await page.keyboard.press('End');
  await page.locator('#volumeRight').focus(); await page.keyboard.press('Home');
  await page.locator('#tone').selectOption('low');
  await page.locator('#audioEnable').click();
  await page.locator('[data-mode="play"]').click();
  await advanceFrame(page, record, 'Theme invariant baseline', 32);
  const before = await invariant(page);
  assert(before.state.selectedId, 'The invariant comparison must preserve a selected part');
  assert.equal(before.state.mode, 'play'); assert(before.state.tapePosition > .4 && before.state.tapePosition < .6);
  assert.equal(before.state.audioEnabled, true);
  assert(before.appearanceInvariant, 'The snapshot must include actual camera/material/light/renderer/audio values');
  await writeFile(path.join(output, `${record.browser}-${record.protocol}-theme-invariant.json`), JSON.stringify(before, null, 2) + '\n');
  for (const theme of ['dark', 'light', 'system']) {
    await page.locator('#theme-select').selectOption(theme);
    assert.deepEqual(await invariant(page), before, theme + ': switching theme must preserve the entire frozen viewer state');
  }
  record.theme.statePreserved = {selected: before.state.selectedId, mode: before.state.mode, tape: before.state.tapePosition,
    audioEnabled: before.state.audioEnabled, sameFrames: true, fields: ['state', 'parts', 'appearanceInvariant']};
  // Preferences affect the backdrop immediately but never the camera/model state.
  await page.emulateMedia({colorScheme: 'dark'}); await assertTheme(page, 'dark', 'system');
  assert.deepEqual(await invariant(page), before);
  await page.emulateMedia({colorScheme: 'light'}); await assertTheme(page, 'light', 'system');
  assert.deepEqual(await invariant(page), before);
  await page.locator('#theme-select').selectOption('dark');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), 'dark');
  await page.locator('#reset').click(); await assertTheme(page, 'dark', 'dark');
  record.theme.resetPreserved = true;

  for (const kind of ['stop', 'eject']) {
    await page.locator('#reset').click(); await page.locator('#door').click();
    if (kind === 'stop') await page.locator('[data-mode="play"]').click();
    await page.locator('#eject').click();
    await advanceFrame(page, record, 'Theme during pending ' + kind, 32);
    const pending = await invariant(page);
    assert(pending.state.stopTravel > 0 && pending.state.stopTravel < 1);
    assert.equal(pending.appearanceInvariant.pending.stopCycle.kind, kind);
    for (const theme of ['light', 'dark', 'system']) {
      await page.locator('#theme-select').selectOption(theme);
      assert.deepEqual(await invariant(page), pending, 'Theme must preserve pending ' + kind + ' without advancing time');
    }
  }
  record.theme.pendingCyclesPreserved = ['stop', 'eject'];
  await page.locator('#reset').click();

  for (const theme of ['light', 'dark']) {
    await page.locator('#theme-select').selectOption(theme);
    const colors = [];
    for (const view of ['assembled', 'service', 'exploded', 'catalog']) {
      await page.locator(`button[data-view="${view}"]`).click();
      await advanceFrame(page, record, `${theme} ${view} backdrop`, 32);
      await canvasColor(page, record.theme, theme + '-' + view);
      colors.push(record.theme.canvas.at(-1).expected.color);
      if (view === 'exploded' || view === 'catalog') {
        const screenshot = `${record.browser}-${record.protocol}-theme-${theme}-${view}.png`;
        await page.screenshot({path: path.join(output, screenshot)}); record.theme.screenshots.push(screenshot);
      }
    }
    assert.notEqual(colors[0], colors[1], 'Assembled and separated backdrops must remain distinct');
  }
  await page.locator('#theme-select').selectOption('system');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), null, 'System must remove the stored override');
  await page.locator('#reset').click();
  await advanceFrame(page, record, 'Theme suite final reset', 32);
  await page.locator('#theme-select').selectOption('dark');
  await advanceFrame(page, record, 'Dark assembled preview', 32);
  const preview = `${record.browser}-${record.protocol}-theme-dark-assembled.png`;
  await page.screenshot({path: path.join(output, preview)}); record.theme.screenshots.push(preview);
  record.theme.passed = true;
}
