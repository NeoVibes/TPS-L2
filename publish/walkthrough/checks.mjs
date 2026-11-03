// Regression checks of the generated viewer, driven through chrome.mjs: startup, keyboard zoom, interrupted
// STOP/EJECT under a frozen clock, inspector and catalog interaction, preferences, failure recovery and
// loading races. Each check takes its own context, so storage never carries over. Run by run.mjs.
import assert from 'node:assert/strict';
import path from 'node:path';
import {MUSIC_DRIFT_SECONDS} from '../../rebuild/viewer/audio.mjs';

const snapshot = page => page.evaluate('window.portableTapePlayer.snapshot()');
const ready = page => page.waitFor('window.portableTapePlayer?.snapshot().ready', 90);
// Polls fn in the page until it returns something truthy; a returned {error} fails at once.
async function until(page, fn, args = [], seconds = 90) {
  const start = Date.now();
  for (;;) {
    let value; try { value = await page.call(fn, ...args); } catch {}
    if (value?.error) throw Error(value.error);
    if (value) return value;
    if (Date.now() - start > seconds * 1000) throw Error('Timed out waiting for ' + String(fn).slice(0, 160));
    await new Promise(r => setTimeout(r, 50));
  }
}
const nextFrames = page => page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))');

// The one readiness signal every check waits on: the named packages decoded, and a frame of the expected view
// rendered with geometry (the viewer's own diagnostics: snapshot().loaded and #stage's render record).
export async function renderedView(page, record, packages, view = 'assembled') {
  await until(page, packages => {
    const s = window.portableTapePlayer?.snapshot();
    if (window.portableTapePlayerError) return {error: window.portableTapePlayerError};
    if (s?.packageErrors.length) return {error: s.packageErrors.join('\n')};
    return s?.ready && packages.every(name => s.loaded.includes(name));
  }, [packages]);
  await nextFrames(page);
  const observed = await page.call(() => {
    const s = window.portableTapePlayer.snapshot(), text = document.getElementById('stage').dataset.test;
    return {ready: s.ready, loaded: s.loaded, packageErrors: s.packageErrors, view: s.state.view, frames: s.renderedFrames, render: text && JSON.parse(text)};
  });
  assert.equal(observed.ready, true); assert.deepEqual(observed.packageErrors, []);
  assert(packages.every(name => observed.loaded.includes(name)));
  assert.equal(observed.view, view); assert.equal(observed.render?.view, view);
  assert.equal(observed.render.frames, observed.frames);
  assert(observed.frames > 0 && observed.render.draws > 0 && observed.render.triangles > 0, 'The fixture must have rendered its loaded geometry');
  (record.readiness ||= []).push({phase: record.phase, loaded: observed.loaded, view, frames: observed.frames, draws: observed.render.draws, triangles: observed.render.triangles});
}
async function select(page, id) {
  await page.call(() => { document.getElementById('catalog').open = true; });
  await page.fill('#search', id);
  await page.press('#results button', {text: '^' + id + ' ·'});
}

// A frozen application clock for the interrupted strokes: performance.now and requestAnimationFrame are taken
// over, so one advance(ms) runs exactly one frame, with exactly ms of time passed. Installed after startup.
const CLOCK = `(()=>{if(window.__clock)return true;
  const nativeRaf=requestAnimationFrame.bind(window);let now=performance.now(),queue=[],id=0;
  Object.defineProperty(performance,'now',{value:()=>now,configurable:true});
  window.requestAnimationFrame=cb=>{queue.push({id:++id,cb});return id};
  window.cancelAnimationFrame=x=>{queue=queue.filter(q=>q.id!==x)};
  window.__clock={nativeRaf,advance(ms){now+=ms;const run=queue;queue=[];for(const q of run)q.cb(now);return now}};return true})()`;
const observation = page => page.call(() => {
  const s = window.portableTapePlayer.snapshot();
  return {state: s.state, frames: s.renderedFrames, now: performance.now(), render: JSON.parse(document.getElementById('stage').dataset.test)};
});
export async function advanceFrame(page, record, label, milliseconds) {
  const before = await observation(page);
  await page.call(ms => window.__clock.advance(ms), milliseconds);
  const after = await observation(page);
  assert.equal(after.frames, before.frames + 1, label + ': exactly one real viewer render must complete');
  assert.equal(after.render.frames, after.frames, label + ': render diagnostics must describe that frame');
  assert(after.render.draws > 0 && after.render.triangles > 0, label + ': geometry must be rendered');
  assert(Math.abs(after.now - before.now - milliseconds) < 1e-6, label + ': only the requested test time may elapse');
  record.clock.steps.push({label, milliseconds, before: before.frames, after: after.frames, draws: after.render.draws, triangles: after.render.triangles});
  return after;
}
async function prepareInterruptionClock(page, record) {
  record.phase = 'interruption-clock';
  await page.waitFor(`['exterior','mechanism','electronics','cassette'].every(n=>window.portableTapePlayer.snapshot().loaded.includes(n))`, 30);
  const state = (await snapshot(page)).state;
  assert.equal(state.mode, 'stop'); assert.equal(state.stopCycle, null);
  record.clock = {scope: 'interrupted STOP/EJECT and theme state', steps: []};
  await page.evaluate(CLOCK);
  // The idle viewer's one outstanding native frame runs and re-queues itself on the frozen clock.
  await page.evaluate('new Promise(r=>window.__clock.nativeRaf(()=>window.__clock.nativeRaf(()=>r(true))))');
  await page.press('#reset');
  await advanceFrame(page, record, 'Stopped clock baseline', 32);
}

async function zoom(page, record) {
  record.phase = 'keyboard-zoom';
  await page.press('[data-workmode="inspect"]');
  const extent = () => page.call(() => {
    const points = Object.values(window.portableTapePlayer.snapshot().controls).filter(Boolean);
    if (points.length < 2) throw Error('No projected control bounds');
    return Math.hypot(Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)));
  });
  record.zoom = [];
  for (const projection of ['perspective', 'orthographic']) {
    await page.select('#projection', projection);
    await page.press('#homeCamera');
    await page.focus('#canvas');
    const before = await extent();
    await page.key('Shift+Equal');
    const larger = await extent();
    assert(larger > before * 1.01, `${projection}: + must enlarge projected controls (${before} -> ${larger})`);
    await page.key('Minus');
    const smaller = await extent();
    assert(smaller < larger * .99, `${projection}: - must shrink projected controls`);
    record.zoom.push({projection, before, larger, smaller});
  }
  await page.select('#projection', 'perspective');
}

async function interruptedAction(page, kind, record) {
  record.phase = kind + '-interruption';
  await page.press('#reset');
  await page.press('[data-workmode="operate"]');
  await page.press('#door');
  await page.focus('#speed'); await page.key('Home');
  if (kind === 'stop') await page.press('[data-mode="play"]');
  await page.press('#eject');
  const partial = await advanceFrame(page, record, kind + ' partial stroke', 200), during = partial.state;
  assert.equal(during.speed, .05);
  assert.equal(partial.render.stopCycle, kind, 'The intended mechanical stroke must be pending');
  assert(during.stopTravel > 0 && during.stopTravel < 1, 'Interrupt a moving stroke before the press commits');
  assert.equal(during.door, true); assert.equal(during.media, 'loaded');
  assert.equal(during.mode, kind === 'stop' ? 'play' : 'stop', 'The stroke must not have committed');
  const cancelled = (state, view) => {
    assert.equal(state.view, view);
    assert.equal(state.stopCycle, null, kind + ': cancel the pending stroke immediately');
    assert.equal(state.stopTravel, 0); assert.equal(state.media, 'loaded'); assert.equal(state.mode, 'stop');
  };
  await page.focus('#spread'); await page.key('End');
  cancelled((await observation(page)).state, 'catalog');
  await page.key('Home');
  cancelled((await observation(page)).state, 'assembled');
  await page.focus('#speed'); await page.key('End');
  // One deliberately long frame exceeds the full stroke duration; it complements the immediate checks above.
  const after = (await advanceFrame(page, record, kind + ' after reassembly', 900)).state;
  cancelled(after, 'assembled');
  (record.interruptions ||= []).push({kind, interruptedAt: during.stopTravel, partialStepMs: 200, immediateCancellation: true,
    after: {mode: after.mode, media: after.media, stopTravel: after.stopTravel}});
}

// Startup and the checks that share its page: theme accessibility, zoom, interrupted strokes, theme state.
// Hosted runs only the startup part. Ends with the page-wide no-error, no-network and CSP checks.
export async function viewerChecks({browser, url, record, output, full, theme}) {
  const context = await browser.context();
  const page = await context.page({width: 1400, height: 900, reducedMotion: 'reduce'});
  try {
    record.phase = 'startup';
    await page.goto(url, {until: 'load'});
    await page.waitFor('window.portableTapePlayer?.snapshot().ready || window.portableTapePlayerError', 90);
    assert.equal(await page.evaluate('window.portableTapePlayerError || null'), null, 'Viewer must initialize');
    record.phase = 'render-readiness';
    await page.waitFor(`(()=>{const t=document.getElementById('stage')?.dataset.test;return t&&JSON.parse(t).triangles>0&&JSON.parse(t).draws>0})()`, 30);
    const initial = await snapshot(page);
    assert(initial.renderedFrames > 0, 'WebGL must render a frame');
    const rendered = await page.evaluate('JSON.parse(document.getElementById("stage").dataset.test)');
    record.initial = {frames: initial.renderedFrames, loaded: initial.loaded, draws: rendered.draws, triangles: rendered.triangles};
    if (full) {
      record.phase = 'regressions';
      record.theme = {contrast: [], canvas: [], screenshots: []};
      await theme.themeAccessibility({page, record, output});
      await zoom(page, record);
      await prepareInterruptionClock(page, record);
      await interruptedAction(page, 'stop', record);
      await interruptedAction(page, 'eject', record);
      await theme.themeRuntime({page, record, output, advanceFrame});
    } else {
      // Hosted: every package must still load over HTTP.
      await page.press('[data-workmode="inspect"]');
      await renderedView(page, record, ['exterior', 'cassette', 'mechanism', 'electronics']);
    }
    record.phase = 'page-wide-diagnostics';
    const final = await snapshot(page);
    const origin = new URL(url).origin;
    record.diagnostics = final.diagnostics;
    record.failedRequests = page.log.failed;
    record.externalRequests = page.log.requests.filter(u => /^https?:/.test(u) && new URL(u).origin !== origin);
    assert.deepEqual(final.packageErrors, [], 'No package loading errors');
    assert.deepEqual(page.log.errors, [], 'No uncaught page errors');
    assert.deepEqual(page.log.console.filter(l => l.startsWith('error')), [], 'No console errors');
    assert.deepEqual(page.log.failed, [], 'No failed requests');
    assert.deepEqual(record.externalRequests, [], 'Runtime must stay offline');
    assert.deepEqual(final.diagnostics.errors, [], 'No document errors');
    assert.deepEqual(final.diagnostics.violations, [], 'No CSP violations');
    await page.screenshot(path.join(output, `${record.protocol}-viewer.png`));
  } finally { await context.close(); }
}

export async function interactionChecks({browser, url, record, output}) {
  const context = await browser.context(), page = await context.page({width: 390, height: 1000, reducedMotion: 'reduce'});
  try {
    record.phase = 'interaction';
    await page.goto(url, {until: 'load'}); await ready(page); await select(page, 'BLT-001');
    await page.focus('#copyPartDetails'); await page.key('Escape');
    assert(!await page.visible('#inspector'));
    assert(await page.evaluate(`document.querySelector('#catalog summary')===document.activeElement`), 'Escape returns focus to the catalog');
    await select(page, 'BLT-001'); await page.focus('#exteriorVersion'); await page.key('Space'); await page.key('Escape'); assert(await page.visible('#inspector'));
    await page.focus('#copyPartDetails'); await page.click('#toggleInspector');
    assert(!await page.visible('#inspectorBody')); assert(await page.evaluate(`document.getElementById('toggleInspector')===document.activeElement`));
    await select(page, 'BAY-052'); assert(!await page.visible('#inspectorBody')); assert.equal(await page.evaluate(`document.getElementById('toggleInspector').getAttribute('aria-expanded')`), 'false');
    await page.press('#closeInspector'); await select(page, 'BLT-001'); assert(!await page.visible('#inspectorBody'));
    await page.press('#toggleInspector'); assert(await page.visible('#inspectorBody'));
    await page.focus('#copyPartDetails'); await page.press('#toggleInspector');
    assert(await page.evaluate(`document.getElementById('toggleInspector')===document.activeElement`), 'A pointer collapse must retain focus even when the browser blurs the body control before click');
    await page.press('#toggleInspector');
    for (const theme of ['light', 'dark']) {
      await page.select('#theme-select', theme); await page.focus('#copyPartDetails');
      assert(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'));
      await page.screenshot(path.join(output, `${record.protocol}-inspector-${theme}.png`), {fullPage: true});
    }
    record.interaction = 'passed';
  } finally { await context.close(); }
}

const PREFERENCE_WRITES = `(()=>{const set=Storage.prototype.setItem;window.__preferenceWrites=[];Storage.prototype.setItem=function(k,v){if(k==='tpsl2-viewer-preferences')window.__preferenceWrites.push(v);return set.call(this,k,v);};})()`;
export async function preferenceChecks({browser, url, record, output}) {
  const context = await browser.context(), page = await context.page({reducedMotion: 'reduce', init: [PREFERENCE_WRITES]});
  try {
    record.phase = 'preferences-startup';
    await page.goto(url, {until: 'load'}); await renderedView(page, record, ['exterior', 'cassette']);
    await page.press('[data-workmode="inspect"]');
    record.phase = 'preferences-details';
    await renderedView(page, record, ['exterior', 'cassette', 'mechanism', 'electronics']);
    record.phase = 'preferences-save';
    await page.select('#projection', 'orthographic');
    await page.press('[data-view="exploded"]');
    await renderedView(page, record, ['exterior', 'cassette', 'mechanism', 'electronics'], 'exploded');
    await page.press('#toggleLabels');
    await page.press('#motionCues'); assert.equal(await page.evaluate(`document.getElementById('motionCues').checked`), false);
    assert.equal(await page.evaluate('window.__preferenceWrites.length'), 2, 'labels and motion cues are saved; the projection is not');
    record.phase = 'preferences-reload';
    await page.reload({until: 'load'}); await renderedView(page, record, ['exterior', 'cassette']);
    const check = async () => {
      const s = (await snapshot(page)).state;
      assert.equal(s.projection, 'perspective', 'the viewer opens in perspective'); assert.equal(s.labels, false); assert.equal(await page.evaluate(`document.getElementById('motionCues').checked`), false);
      assert.equal(await page.evaluate('window.__preferenceWrites.length'), 0);
    };
    await check(); record.phase = 'preferences-reset'; await page.press('#reset'); await check();
    record.phase = 'preferences-tour';
    await page.press('[data-workmode="tour"]');
    // Persistence across tour changes, not elapsed playback: Start, Pause and seek in one task, so no tour frame runs between.
    record.phase = 'preferences-tour-setup';
    const tourSetup = await page.call(() => {
      const control = id => {
        const element = document.getElementById(id), style = element && getComputedStyle(element);
        if (!element || element.disabled || element.hidden || !element.getClientRects().length || style.visibility === 'hidden' || style.visibility === 'collapse') throw Error('Tour control unavailable: ' + id);
        return element;
      };
      const before = window.portableTapePlayer.snapshot().state;
      if (before.uiMode !== 'tour' || before.tour !== -1) throw Error('Tour setup must start in idle Tour mode');
      control('tour').click();
      const started = window.portableTapePlayer.snapshot().state;
      if (started.tour < 0 || started.paused) throw Error('Start control did not start the tour');
      control('tourPause').click();
      const paused = window.portableTapePlayer.snapshot().state.paused;
      if (!paused) throw Error('Pause control did not pause the tour');
      const seek = control('tourSeek'); seek.value = '64'; seek.dispatchEvent(new Event('input', {bubbles: true}));
      return {started: started.tour, paused, state: window.portableTapePlayer.snapshot().state};
    });
    assert(tourSetup.started >= 0); assert.equal(tourSetup.paused, true);
    assert.equal(tourSetup.state.view, 'exploded'); assert.equal(tourSetup.state.paused, true);
    record.phase = 'preferences-tour-render';
    await until(page, () => {
      const s = window.portableTapePlayer.snapshot(), text = document.getElementById('stage').dataset.test, render = text && JSON.parse(text);
      return s.ready && ['exterior', 'mechanism', 'electronics', 'cassette'].every(n => s.loaded.includes(n)) && render?.view === 'exploded' && render.draws > 0 && render.triangles > 0;
    });
    await check();
    record.phase = 'preferences-inspect';
    await page.press('[data-workmode="inspect"]');
    await page.waitFor(`(()=>{const s=window.portableTapePlayer.snapshot().state;return s.uiMode==='inspect'&&s.tour===-1})()`);
    record.phase = 'preferences-context';
    await page.press('[data-context="motorAssembly"]'); await check();
    record.phase = 'preferences-clear-context';
    await page.press('#clearContext'); await check();
    record.phase = 'preferences-invalid';
    await page.evaluate(`localStorage.setItem('tpsl2-viewer-preferences','{bad')`); await page.reload({until: 'load'});
    await renderedView(page, record, ['exterior', 'cassette']);
    assert.equal((await snapshot(page)).state.projection, 'perspective');
    record.phase = 'preferences-denied';
    await page.addInit(`Object.defineProperty(window,'localStorage',{get(){throw Error('storage denied');}});`);
    await page.goto(url + '#part=BLT-001'); await page.waitFor(`location.hash==='#part=BLT-001'`, 10);
    // A fragment-only navigation keeps the document and skips the new startup script: reload, then prove storage throws.
    await page.reload({until: 'load'});
    assert.equal(await page.evaluate('(()=>{try{void window.localStorage;return false}catch{return true}})()'), true, 'Storage access must be denied in this fixture');
    await renderedView(page, record, ['exterior', 'cassette', 'mechanism', 'electronics']);
    await page.press('[data-workmode="inspect"]'); await page.select('#projection', 'orthographic');
    assert.equal(await page.evaluate(`document.getElementById('partId').textContent`), 'BLT-001');
    assert.equal((await snapshot(page)).state.projection, 'orthographic');
    record.preferences = 'passed';
  } catch (error) {
    record.preferenceFailure = await page.call(() => {
      const s = window.portableTapePlayer?.snapshot();
      return {ready: s?.ready, state: s?.state, loaded: s?.loaded, packageErrors: s?.packageErrors, renderedFrames: s?.renderedFrames,
        render: document.getElementById('stage')?.dataset.test || null, preferenceWrites: window.__preferenceWrites?.length, hash: location.hash,
        focusedControl: document.activeElement?.id || document.activeElement?.dataset?.workmode || null};
    }).catch(e => ({captureError: String(e)}));
    await page.screenshot(path.join(output, `${record.protocol}-preferences-failure.png`)).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

const CLIPBOARD = `Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copied=text;if(window.__denyCopy)throw Error('Denied');}}});`;
export async function catalogChecks({browser, url, record}) {
  const context = await browser.context(), page = await context.page({width: 1440, height: 1000, reducedMotion: 'reduce', init: [CLIPBOARD]});
  const count = selector => page.call(sel => document.querySelectorAll(sel).length, selector);
  const attr = (selector, name) => page.call((sel, n) => document.querySelector(sel).getAttribute(n), selector, name);
  const value = selector => page.call(sel => document.querySelector(sel).value, selector);
  const text = selector => page.call(sel => document.querySelector(sel).innerText, selector);
  try {
    record.phase = 'catalog';
    await page.goto(url, {until: 'load'}); await ready(page);
    await page.call(() => { document.getElementById('catalog').open = true; }); await page.fill('#search', '  pinch   ROLLER  ');
    assert.equal(await attr('#searchCount', 'aria-atomic'), 'true');
    assert.equal(await attr('#results', 'aria-live'), null);
    await page.press('#clearSearch'); assert.equal(await count('#results button'), 60);
    await page.evaluate(`window.__first=document.querySelector('#results button')`); await page.press('#moreComponents');
    assert.equal(await count('#results button'), 120); assert(await page.evaluate(`window.__first===document.querySelector('#results button')`));
    while (await attr('#moreComponents', 'aria-disabled') === 'false') await page.press('#moreComponents');
    const total = Number((await text('#searchCount')).match(/of (\d+)/)[1]); assert.equal(await count('#results button'), total);
    assert(await page.evaluate(`document.getElementById('moreComponents')===document.activeElement`));
    await page.fill('#search', '8-835-008-11'); assert.equal(await count('#results button'), 31);
    await page.fill('#search', 'nonexistent-id'); assert(await page.visible('#searchEmpty'));
    await select(page, 'BLT-001'); assert.equal(await text('#partMeasure'), 'X 66.7 × Y 19.3 × Z 4.5 mm');
    await page.press('#copyPartDetails'); assert.match(await page.evaluate('window.__copied'), /66.714.*19.338.*4.509/);
    await page.evaluate('window.__denyCopy=true'); await page.press('#copyPartDetails'); assert.match(await value('#copyFallback'), /stopped model, lid closed, cassette seated/);
    await page.call(() => { document.getElementById('masterList').open = true; }); await page.fill('#masterSearch', 'MEDIA-001');
    for (const variant of ['original', 'detailed']) {
      await page.press('#masterResults button', {text: variant + ' cassette'}); assert.equal(await value('#copyFallback'), '');
      assert.equal(await count('#partConfirmation h3'), 1); await page.press('#copyPartDetails'); assert.match(await value('#copyFallback'), new RegExp('Cassette: ' + variant));
    }
    await page.fill('#masterSearch', 'EXT-030'); await page.press('#masterResults button', {text: 'intermediate and early'}); assert.match(await text('#partConfirmation'), /Intermediate and early exterior/);
    await page.press('#masterClear'); assert.equal(await count('#masterResults button'), 60);
    await page.select('#masterStatus', 'not modelled'); await page.select('#masterLevel', '0');
    await page.press('#masterMore'); assert.equal(await value('#masterStatus'), 'not modelled');
    while (await attr('#masterMore', 'aria-disabled') === 'false') await page.press('#masterMore');
    await page.fill('#masterSearch', 'xyz-none'); assert(await page.visible('#masterEmpty')); await page.press('#masterClear'); assert.equal(await value('#masterStatus'), '');
    for (const id of ['MTR-001', 'MEC-011', 'BAY-052', 'BAY-061', 'BAY-060']) { await select(page, id); assert(await page.visible('#partExplanation')); }
    assert.equal(await count('.photo-request'), 4);
    record.catalog = 'passed';
  } finally { await context.close(); }
}

export async function failureChecks({browser, url, record, output}) {
  record.failures = [];
  for (const failure of ['webgl', 'geometry', 'metadata', 'context']) {
    record.phase = 'failure-' + failure;
    const context = await browser.context();
    const page = await context.page({width: 1440, height: 1000, reducedMotion: 'reduce', init: [
      ...(failure === 'webgl' ? ['HTMLCanvasElement.prototype.getContext=()=>null;'] : []),
      `Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('Denied');}}});`]});
    try {
      if (failure === 'geometry') await page.route('/geometry/exterior.js', r => r.fail());
      if (failure === 'metadata') await page.route('/geometry/model.js', r => r.fail());
      await page.goto(url + '#part=BLT-001&exterior=early');
      if (failure === 'context') {
        // The part link enters Inspect and starts detail loads; finish them before dismissing and losing an established context.
        await renderedView(page, record, ['exterior', 'cassette', 'mechanism', 'electronics']);
        await page.press('#closeInspector');
        await page.waitFor(`!document.getElementById('inspector').getClientRects().length||getComputedStyle(document.getElementById('inspector')).visibility!=='visible'`, 30);
        assert.equal(new URL(await page.url()).hash, '#exterior=early');
        assert.equal((await snapshot(page)).state.selectedId, null);
        await page.press('[data-workmode="operate"]');
        await page.press('#audioEnable'); await page.press('[data-mode="play"]');
        assert.equal((await snapshot(page)).state.audioEnabled, true);
        assert.equal((await snapshot(page)).state.mode, 'play');
        await page.evaluate(`(()=>{const e=document.getElementById('canvas').getContext('webgl2').getExtension('WEBGL_lose_context');if(!e)throw Error('Context loss extension unavailable');e.loseContext();return true})()`);
      }
      await page.waitFor(`document.getElementById('loadingTitle').textContent==='3D unavailable; parts catalog available.'`, 90);
      assert.equal(await page.evaluate(`document.getElementById('shell').getAttribute('aria-busy')`), 'false');
      assert(await page.visible('#loadingRetry')); assert(!await page.visible('#retryAssets'));
      for (const id of ['tour', 'projection', 'section', 'homeCamera', 'spread', 'focus', 'isolate', 'audioEnable']) assert(await page.disabled('#' + id), failure + ': ' + id);
      await page.call(() => { document.getElementById('masterList').open = true; }); await page.fill('#masterSearch', 'capstan');
      assert(await page.evaluate(`document.querySelectorAll('#masterResults button').length`) > 0);
      if (failure !== 'metadata') {
        await select(page, 'BLT-001'); await page.press('#copyPartDetails'); assert.match(await page.evaluate(`document.getElementById('copyFallback').value`), /66.714/);
        await page.call(() => { document.getElementById('catalog').open = true; }); await page.press('#clearSearch'); await page.press('#moreComponents');
        assert.equal(await page.evaluate(`document.querySelectorAll('#results button').length`), 120);
        await page.select('#exteriorVersion', 'intermediate'); assert(await page.disabled('#focus'));
      } else { assert(await page.disabled('#search')); assert.match(await page.evaluate(`document.getElementById('storyText').innerText`), /metadata did not load/); }
      await page.evaluate(`(()=>{window.__csv=null;const make=URL.createObjectURL;URL.createObjectURL=b=>{b.text().then(t=>window.__csv=t);return make(b)};document.getElementById('masterDownload').click();return true})()`);
      await page.waitFor(`window.__csv?.includes('row_id')`, 30);
      await page.screenshot(path.join(output, `${record.protocol}-${failure}-catalog.png`));
      if (failure === 'context') {
        const frames = (await snapshot(page)).renderedFrames; await new Promise(r => setTimeout(r, 250));
        const after = await page.evaluate('window.portableTapePlayer.snapshot({appearance:true})');
        assert.equal(after.renderedFrames, frames); assert.equal(after.state.audioEnabled, false); assert.equal(after.state.mode, 'stop');
        await page.press('#loadingRetry'); await ready(page); assert(!await page.visible('#loading'));
      }
      record.failures.push({case: failure, passed: true});
    } finally { await context.close(); }
  }
}

// Holds real package requests across user actions, so a completed load cannot undo a newer selection
// or the catalog-only recovery state.
const GEOMETRY_READS = `(()=>{const read=Response.prototype.arrayBuffer;window.__geometryReadsCompleted=0;Response.prototype.arrayBuffer=async function(...a){const r=await read.apply(this,a);window.__geometryReadsCompleted++;return r};})()`;
export async function loadingRaceChecks({browser, url, record}) {
  record.loadingRaces = [];
  const errors = [];
  const hold = () => { let release; const held = new Promise(r => { release = r; }); return {held, handler: r => release(r)}; };
  const started = held => Promise.race([held, new Promise((_, reject) => setTimeout(() => reject(Error('Expected delayed geometry request did not start')), 30000))]);
  const unavailable = async page => {
    assert(await page.visible('#loading')); assert(await page.visible('#loadingRetry')); assert(!await page.visible('#retryAssets'));
    assert.equal(await page.evaluate(`document.getElementById('shell').getAttribute('aria-busy')`), 'false');
    for (const id of ['tour', 'projection', 'focus', 'audioEnable']) assert(await page.disabled('#' + id));
    assert.equal(await page.evaluate('Boolean(window.portableTapePlayer?.snapshot().ready)'), false);
  };
  const run = async (name, body) => {
    record.phase = 'loading-race-' + name;
    const context = await browser.context(), page = await context.page({width: 1440, height: 1000, reducedMotion: 'reduce', init: [GEOMETRY_READS]});
    try { await body(page); errors.push(...page.log.errors); record.loadingRaces.push({case: name, passed: true}); } finally { await context.close(); }
  };
  await run('context-lost-during-startup', async page => {
    const {held, handler} = hold();
    await page.route('/geometry/exterior.js', handler);
    await page.goto(url, {until: 'domcontentloaded'});
    const request = await started(held);
    await page.evaluate(`(()=>{const e=document.getElementById('canvas').getContext('webgl2').getExtension('WEBGL_lose_context');if(!e)throw Error('Context loss extension unavailable');e.loseContext();return true})()`);
    await page.waitFor(`document.getElementById('loading').dataset.unavailable==='true'`, 30);
    await unavailable(page);
    await request.continue();
    await page.waitFor('window.__geometryReadsCompleted>0', 30);
    await unavailable(page);
    await select(page, 'MTR-001'); assert(await page.visible('#inspector'));
    await page.unroute('/geometry/exterior.js');
    await page.press('#loadingRetry'); await ready(page);
    assert(!await page.visible('#loading'));
  });
  for (const name of ['mechanism', 'electronics']) await run(name + '-failure-after-startup', async page => {
    const {held, handler} = hold();
    await page.route('/geometry/cassette/cassette.js', handler);
    await page.route('/geometry/' + name + '.js', r => r.fail());
    await page.goto(url, {until: 'domcontentloaded'}); await ready(page); const request = await started(held);
    await page.press('[data-view="exploded"]');
    await page.waitFor('window.portableTapePlayer.snapshot().state.graphicsUnavailable', 30);
    await unavailable(page);
    const before = await page.evaluate('({frames:window.portableTapePlayer.snapshot().renderedFrames,reads:window.__geometryReadsCompleted})');
    await request.continue(); await page.waitFor('window.__geometryReadsCompleted>' + before.reads, 30);
    await unavailable(page);
    assert.match(await page.evaluate(`document.getElementById('loadingText').innerText`), new RegExp('geometry/' + name + '\\.js'));
    assert.equal((await snapshot(page)).renderedFrames, before.frames);
    await select(page, 'MTR-001'); assert(await page.visible('#inspector'));
    await page.unroute('/geometry/' + name + '.js'); await page.unroute('/geometry/cassette/cassette.js');
    await page.press('#loadingRetry'); await ready(page);
    assert.equal((await snapshot(page)).state.selectedId, 'MTR-001');
    assert.equal(new URL(await page.url()).hash, '#part=MTR-001');
    // This view change clears the part fragment without loading a new document.
    await page.press('[data-view="exploded"]');
    await page.waitFor(`(()=>{const s=window.portableTapePlayer.snapshot();return s.ready&&s.state.view==='exploded'&&s.state.selectedId===null&&location.hash===''})()`, 30);
    await page.waitFor(`!document.getElementById('inspector').getClientRects().length||getComputedStyle(document.getElementById('inspector')).visibility!=='visible'`, 30);
    await page.waitFor(`['exterior','mechanism','electronics','cassette'].every(n=>window.portableTapePlayer.snapshot().loaded.includes(n))`, 60);
    assert.deepEqual((await snapshot(page)).packageErrors, []);
  });
  await run('selection-during-context-loading', async page => {
    const {held, handler} = hold();
    await page.route('/geometry/mechanism.js', handler);
    await page.goto(url, {until: 'load'}); await ready(page);
    await page.press('[data-workmode="inspect"]'); await page.press('[data-context="motorAssembly"]');
    const request = await started(held); await select(page, 'MTR-001');
    const hash = await page.evaluate('location.hash');
    await request.continue();
    await page.waitFor(`['mechanism','electronics'].every(n=>window.portableTapePlayer.snapshot().loaded.includes(n))`, 60);
    assert.equal((await snapshot(page)).state.selectedId, 'MTR-001');
    assert(await page.visible('#inspector')); assert.equal(await page.evaluate('location.hash'), hash);
    // The guard must still let a later, deliberate assembly selection finish.
    await page.press('[data-context="motorAssembly"]');
    await page.waitFor(`location.hash.startsWith('#context=motorAssembly')`, 30);
    assert(!await page.visible('#inspector'));
  });
  assert.deepEqual(errors, [], 'Delayed and failed loads must not cause uncaught errors');
}

// The music (plan section 4): read only when sound is enabled with it chosen; plays at tape time and motion speed
// through the page's own audio graph; silent below the browser's slowest rate and past its end; the test tone
// takes over at the same tape position; STOP and disabling silence it; a missing file is reported and the viewer
// stays usable. Real time: the audio clock cannot be frozen.
export async function musicChecks({browser, url, record}) {
  record.music = [];
  const level = page => page.evaluate('window.portableTapePlayer.snapshot().audio.level');
  const sample = frameTime => { const stamp = performance.now(), s = window.portableTapePlayer.snapshot(); return {stamp, frameTime, audio:s.audio, state:s.state, tape:s.state.tapePosition*s.state.tapeDuration}; };
  const look = page => page.call(sample);
  // Tape position is committed once per rendered frame; the media clock runs between them.
  const atFrame = page => page.evaluate(`new Promise(done=>requestAnimationFrame(t=>done((${sample})(t))))`);
  const slider = (page, id, value) => page.call((i, v) => { const e = document.getElementById(i); e.value = String(v); e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); return true; }, id, value);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Audio needs a live media clock. Keep the full document and actual WebGL model, but
  // rasterize fewer pixels for this audio-only case on software-rendered CI machines.
  async function musicPage(context) {
    const page = await context.page();
    await page.send('Emulation.setDeviceMetricsOverride', {width:1024, height:720, deviceScaleFactor:.5, mobile:false});
    return page;
  }
  let context = await browser.context(), page = await musicPage(context);
  try {
    record.phase = 'music-startup';
    await page.goto(url, {until: 'load'}); await ready(page);
    let now = await look(page);
    assert.equal(now.state.audioSource, 'music', 'Music is the default sound');
    assert.equal(now.audio.music.loaded || now.audio.music.loading, false, 'Nothing is read before sound is enabled');
    assert(!page.log.requests.some(u => u.includes('canon-in-d')), 'No music request at startup');
    record.phase = 'music-enable';
    await slider(page, 'speed', 1);
    await page.press('#audioEnable');
    await page.waitFor('window.portableTapePlayer.snapshot().audio.music.loaded', 30);
    now = await look(page);
    assert.equal(now.state.mode, 'stop', 'Enabling sound does not start the tape'); assert.equal(now.audio.state, 'ready');
    record.phase = 'music-play';
    await page.press('[data-mode="play"]');
    await page.waitFor('(()=>{const a=window.portableTapePlayer.snapshot().audio;return a.state==="playing"&&a.level>0.001})()', 15);
    // The first PLAY also loads and compiles the mechanism. Measure both clocks after a frame
    // has presented that geometry, including on software renderers with long first draws.
    await renderedView(page, record, ['exterior','mechanism']);
    const playStart = await atFrame(page);
    for (const theme of ['dark', 'light', 'system']) {
      await page.select('#theme-select', theme);
      const during = await look(page);
      assert.equal(during.state.mode, 'play');
      assert.equal(during.audio.source, 'music');
      assert(during.audio.state === 'playing' && during.audio.music.playing, theme + ': recording must keep playing across a theme change');
    }
    await sleep(2000); now = await atFrame(page);
    assert(Math.abs(now.audio.music.duration - 114.43) < 0.5, 'duration ' + now.audio.music.duration);
    // Ongoing playback intentionally tolerates a fixed decoder offset to avoid audible
    // seek loops. Verify its absolute limit AND that both clocks advance in real time.
    // A frozen or mispaced tape must fail even if the initial offset was near zero.
    for (const p of [playStart, now]) {
      assert(p.audio.state === 'playing' && Math.abs(p.audio.music.time-p.tape) <= MUSIC_DRIFT_SECONDS,
        `playing music outside the drift limit: ${p.audio.music.time} vs ${p.tape}`);
    }
    const audioDelta = now.audio.music.time-playStart.audio.music.time, tapeDelta = now.tape-playStart.tape;
    const audioElapsed = (now.stamp-playStart.stamp)/1000, tapeElapsed = (now.frameTime-playStart.frameTime)/1000;
    assert(audioElapsed >= 1.95 && tapeElapsed > 0 && Math.abs(audioDelta-audioElapsed) < .3 && Math.abs(tapeDelta-tapeElapsed) < .3,
      `1× clock progression: media ${audioDelta}/${audioElapsed} s, tape ${tapeDelta}/${tapeElapsed} s`);
    record.music.push({case: 'plays at tape time', music: now.audio.music.time, tape: now.tape, level: now.audio.level, audioDelta, audioElapsed, tapeDelta, tapeElapsed});
    record.phase = 'music-seek';
    const sought = await page.call(t => { const e = document.getElementById('tapePosition'); e.value = String(t); e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); const s = window.portableTapePlayer.snapshot(); return {tape:s.state.tapePosition*s.state.tapeDuration, media:s.audio.music.time}; }, 60 / now.state.tapeDuration);
    assert(Math.abs(sought.tape - 60) <= now.state.tapeDuration * .0005 && Math.abs(sought.media - sought.tape) < .3, 'the seek puts both clocks at the chosen position (one slider step is 0.1% of the side)');
    await sleep(800); now = await atFrame(page);
    assert(now.audio.state === 'playing' && now.audio.music.time > sought.media && now.tape > sought.tape, `music and tape must advance from the seek point (${now.audio.music.time}, ${now.tape})`);
    record.phase = 'music-speed';
    await slider(page, 'speed', .55); const first = await atFrame(page); await sleep(2000); const last = await atFrame(page);
    const advanced = last.audio.music.time - first.audio.music.time, elapsed = (last.stamp-first.stamp)/1000;
    assert(elapsed >= 1.95 && advanced/elapsed > .425 && advanced/elapsed < .7, `at 0.55× music advanced ${advanced.toFixed(2)} s in ${elapsed.toFixed(2)} s`);
    record.music.push({case: 'motion speed 0.55', advanced, elapsed});
    record.phase = 'music-floor';
    await slider(page, 'speed', .05); await sleep(600); now = await look(page);
    assert.match(now.audio.message, /silent below/); assert(await level(page) < .001, 'silent below the slowest rate');
    await slider(page, 'speed', 1);
    record.phase = 'music-past-end';
    await slider(page, 'tapePosition', 190 / now.state.tapeDuration); await sleep(600); now = await look(page);
    assert.match(now.audio.message, /past the end/i); assert.equal(now.state.mode, 'play', 'the tape runs on'); assert(await level(page) < .001);
    record.phase = 'music-switch';
    await slider(page, 'tapePosition', .75); await sleep(300);
    const change = await page.call(() => { const state = () => {const s=window.portableTapePlayer.snapshot().state;return [s.tapePosition,s.mode,s.speed];}; const before=state(), e=document.getElementById('audioSource'); e.value='tone'; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return {before,after:state()}; });
    assert.deepEqual(change.after, change.before, 'switching keeps the tape, mode and speed');
    await page.waitFor('(()=>{const a=window.portableTapePlayer.snapshot().audio;return a.source==="tone"&&a.state==="playing"&&a.level>0.001})()', 10);
    now = await look(page);
    assert.equal(now.state.mode, 'play');
    assert.equal(now.audio.music.playing, false, 'never both at once');
    await page.select('#audioSource', 'music'); await sleep(800); now = await look(page);
    assert.match(now.audio.message, /past the end/i, 'back to the music, which at 75% of the side has ended');
    record.phase = 'music-stop';
    await slider(page, 'tapePosition', 30 / now.state.tapeDuration); await page.waitFor('window.portableTapePlayer.snapshot().audio.state==="playing"', 10);
    await page.press('#eject'); await page.waitFor('window.portableTapePlayer.snapshot().state.mode==="stop"', 10); await sleep(400);
    now = await look(page); assert(await level(page) < .001 && !now.audio.music.playing, 'STOP silences the music');
    record.phase = 'music-disable';
    await page.press('#audioEnable'); now = await look(page); assert.equal(now.audio.state, 'off');
    record.phase = 'music-reset';
    await page.select('#audioSource', 'tone'); await page.press('#reset'); now = await look(page);
    assert.equal(now.state.audioSource, 'music'); assert.equal(now.state.audioEnabled, false); assert.equal(now.state.tapePosition, 0);
    assert.deepEqual(page.log.errors, []);
  } finally { await context.close(); }
  context = await browser.context(); page = await musicPage(context);
  try {
    record.phase = 'music-missing';
    await page.route('/geometry/music/canon-in-d.js', r => r.fail());
    await page.goto(url, {until: 'load'}); await ready(page);
    await page.press('#audioEnable');
    await page.waitFor('window.portableTapePlayer.snapshot().audio.state==="error"', 30);
    assert.match((await look(page)).audio.message, /could not be loaded.*Enable sound to retry.*test tone/);
    await page.select('#audioSource', 'tone'); await page.press('[data-mode="play"]');
    await page.waitFor('(()=>{const a=window.portableTapePlayer.snapshot().audio;return a.state==="playing"&&a.level>0.001})()', 10);
    assert.equal((await page.evaluate('window.portableTapePlayer.snapshot().ready')), true, 'the viewer stays usable');
    record.music.push({case: 'missing file reported; tone still plays'});
  } finally { await context.close(); }
}
