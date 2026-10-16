// Real browser checks of the generated viewer. All evidence stays in rebuild/build/.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {mkdir, readFile, realpath, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), kit = path.resolve(here, '../..');
const view = await realpath(path.join(kit, 'view'));
const args = process.argv.slice(2), feasibility = args.includes('--feasibility');
const output = path.join(kit, 'rebuild/build/browser', feasibility ? 'feasibility' : 'regressions');
const browserArgument = args.find(arg => arg.startsWith('--browser='));
if (args.some(arg => arg !== '--feasibility' && !arg.startsWith('--browser='))) throw Error('Use --feasibility and/or --browser=chromium|firefox|webkit.');
const names = browserArgument ? [browserArgument.split('=')[1]] : ['chromium', 'firefox', 'webkit'];
if (names.some(name => !['chromium', 'firefox', 'webkit'].includes(name))) throw Error('Unknown browser.');
const moduleName = process.env.PTP_PLAYWRIGHT_MODULE || 'playwright';
const playwright = await import(moduleName);
const playwrightPackage = JSON.parse(await readFile(path.join(path.dirname(fileURLToPath(import.meta.resolve(moduleName))), 'package.json'), 'utf8'));
assert.equal(playwrightPackage.version, '1.62.1', 'Use the pinned Playwright version');
await mkdir(output, {recursive: true});

const prefix = '/demo/player/';
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(prefix)) throw Error('outside viewer');
    const file = path.resolve(view, pathname.slice(prefix.length) || 'index.html');
    if (!file.startsWith(view + path.sep) || !(await stat(file)).isFile()) throw Error('not a viewer file');
    const type = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json'}[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, {'Content-Type': type}); createReadStream(file).pipe(response);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const urls = {file: pathToFileURL(path.join(view, 'index.html')).href, hosted: `http://127.0.0.1:${server.address().port}${prefix}`};
const results = [];
const snapshot = page => page.evaluate(() => window.portableTapePlayer.snapshot());
const waitState = (page, predicate) => page.waitForFunction(predicate, null, {timeout: 30000});

async function zoom(page, record) {
  record.phase = 'keyboard-zoom';
  await page.locator('[data-workmode="inspect"]').click();
  const extent = () => page.evaluate(() => {
    const points = Object.values(window.portableTapePlayer.snapshot().controls).filter(Boolean);
    if (points.length < 2) throw Error('No projected control bounds');
    return Math.hypot(Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x)),
      Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y)));
  });
  record.zoom = [];
  for (const projection of ['perspective', 'orthographic']) {
    await page.locator('#projection').selectOption(projection);
    await page.locator('#homeCamera').click();
    await page.locator('#canvas').focus();
    const before = await extent();
    await page.keyboard.press('Shift+Equal');
    const larger = await extent();
    assert(larger > before * 1.01, `${projection}: + must enlarge projected controls (${before} -> ${larger})`);
    await page.keyboard.press('Minus');
    const smaller = await extent();
    assert(smaller < larger * .99, `${projection}: - must shrink projected controls`);
    record.zoom.push({projection, before, larger, smaller});
  }
  await page.locator('#projection').selectOption('perspective');
}

async function interruptedAction(page, kind, record) {
  record.phase = kind + '-interruption';
  await page.locator('#reset').click();
  await page.locator('[data-workmode="operate"]').click();
  await page.locator('#door').click();
  await page.locator('#speed').focus(); await page.keyboard.press('Home');
  if (kind === 'stop') await page.locator('[data-mode="play"]').click();
  await page.locator('#eject').click();
  await waitState(page, () => window.portableTapePlayer.snapshot().state.stopTravel > 0);
  const during = (await snapshot(page)).state;
  assert(during.stopTravel < 1, 'Interrupt before the press commits');
  await page.locator('#spread').focus(); await page.keyboard.press('End');
  await waitState(page, () => window.portableTapePlayer.snapshot().state.view === 'catalog');
  await page.keyboard.press('Home');
  await waitState(page, () => window.portableTapePlayer.snapshot().state.view === 'assembled');
  await page.locator('#speed').focus(); await page.keyboard.press('End');
  // Wait through a full old stroke using animation frames, then inspect observable state.
  await page.evaluate(() => new Promise(resolve => {
    const start = performance.now(); const tick = now => now - start >= 900 ? resolve() : requestAnimationFrame(tick); requestAnimationFrame(tick);
  }));
  const after = (await snapshot(page)).state;
  assert.equal(after.stopCycle, null, kind + ': no pending stroke after reassembly');
  assert.equal(after.stopTravel, 0); assert.equal(after.media, 'loaded'); assert.equal(after.mode, 'stop');
  (record.interruptions ||= []).push({kind, interruptedAt: during.stopTravel, after: {mode: after.mode, media: after.media, stopTravel: after.stopTravel}});
}

try {
  for (const name of names) for (const [protocol, url] of Object.entries(urls)) {
    const record = {browser: name, protocol, playwrightVersion: playwrightPackage.version, platform: process.platform, architecture: process.arch,
      test: feasibility ? 'startup-feasibility' : 'startup-and-regressions', phase: 'launch', passed: false,
      pageErrors: [], consoleErrors: [], failedRequests: [], externalRequests: []};
    let browser, context, page;
    try {
      const launch = {headless: true, timeout: 45000};
      if (name === 'chromium' && process.env.CHROME_BIN) launch.executablePath = process.env.CHROME_BIN;
      browser = await playwright[name].launch(launch);
      record.browserVersion = browser.version(); record.executableOverride = name === 'chromium' && Boolean(process.env.CHROME_BIN);
      context = await browser.newContext({viewport: {width: 1400, height: 900}, reducedMotion: 'reduce'});
      await context.tracing.start({screenshots: true, snapshots: true, sources: false});
      page = await context.newPage();
      record.phase = 'startup';
      page.on('pageerror', error => record.pageErrors.push(String(error)));
      page.on('console', message => { if (message.type() === 'error') record.consoleErrors.push(message.text()); });
      page.on('requestfailed', request => record.failedRequests.push({url: request.url(), failure: request.failure()}));
      page.on('request', request => {
        const target = new URL(request.url());
        if (['http:', 'https:'].includes(target.protocol) && target.origin !== new URL(url).origin) record.externalRequests.push(request.url());
      });
      await page.goto(url, {waitUntil: 'load', timeout: 90000});
      await page.waitForFunction(() => window.portableTapePlayer?.snapshot().ready || window.portableTapePlayerError, null, {timeout: 90000});
      assert.equal(await page.evaluate(() => window.portableTapePlayerError || null), null, 'Viewer must initialize');
      record.phase = 'render-readiness';
      await page.waitForFunction(() => {
        const text = document.getElementById('stage')?.dataset.test;
        return text && JSON.parse(text).triangles > 0 && JSON.parse(text).draws > 0;
      }, null, {timeout: 30000});
      const initial = await snapshot(page);
      assert(initial.renderedFrames > 0, 'WebGL must render a frame');
      const rendered = await page.locator('#stage').evaluate(stage => JSON.parse(stage.dataset.test));
      record.initial = {frames: initial.renderedFrames, loaded: initial.loaded, draws: rendered.draws, triangles: rendered.triangles};
      if (!feasibility) {
        record.phase = 'regressions';
        await zoom(page, record);
        await interruptedAction(page, 'stop', record);
        await interruptedAction(page, 'eject', record);
      }
      const final = await snapshot(page);
      record.diagnostics = final.diagnostics;
      assert.deepEqual(final.packageErrors, [], 'No package loading errors');
      assert.deepEqual(record.pageErrors, [], 'No uncaught page errors');
      assert.deepEqual(record.consoleErrors, [], 'No console errors');
      assert.deepEqual(record.failedRequests, [], 'No failed requests');
      assert.deepEqual(record.externalRequests, [], 'Runtime must stay offline');
      assert.deepEqual(final.diagnostics.errors, [], 'No document errors');
      assert.deepEqual(final.diagnostics.violations, [], 'No CSP violations');
      await page.screenshot({path: path.join(output, `${name}-${protocol}.png`)});
      record.phase = 'complete';
      record.passed = true;
    } catch (error) {
      record.error = String(error.stack || error);
      let diagnosticTimer;
      try {
        record.failureState = await Promise.race([
          page?.evaluate(() => {
            const current = window.portableTapePlayer?.snapshot();
            return {ready: current?.ready, renderedFrames: current?.renderedFrames, loaded: current?.loaded,
              state: current?.state, packageErrors: current?.packageErrors,
              render: document.getElementById('stage')?.dataset.test || null,
              focusedControl: document.activeElement?.id, initializationError: window.portableTapePlayerError || null};
          }).catch(() => null),
          new Promise(resolve => { diagnosticTimer = setTimeout(() => resolve({timedOut: true}), 5000); }),
        ]);
      } finally { clearTimeout(diagnosticTimer); }
      await page?.screenshot({path: path.join(output, `${name}-${protocol}-failure.png`), timeout: 10000}).catch(() => {});
    } finally {
      await context?.tracing.stop({path: path.join(output, `${name}-${protocol}-trace.zip`)}).catch(() => {});
      await context?.close().catch(() => {}); await browser?.close().catch(() => {});
    }
    results.push(record);
    await writeFile(path.join(output, `${name}-${protocol}.json`), JSON.stringify(record, null, 2) + '\n');
    console.log(`${record.passed ? 'PASS' : 'FAIL'} ${name} ${protocol}${record.error ? ': ' + record.error.split('\n')[0] : ''}`);
  }
} finally { await new Promise(resolve => server.close(resolve)); }
await writeFile(path.join(output, 'summary.json'), JSON.stringify({passed: results.every(result => result.passed), results}, null, 2) + '\n');
process.exitCode = results.every(result => result.passed) ? 0 : 1;
