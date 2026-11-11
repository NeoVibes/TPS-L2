// Drives an installed Chrome, headless, over its debugging connection. No extra packages.
// Chrome is found through CHROME_BIN, then the usual install places. One browser serves every check:
// each check opens its own page, in its own context (separate storage) when it needs one.
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function findChrome() {
  const places = [process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'), path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe')];
  const found = places.find(p => p && existsSync(p));
  if (!found) throw new Error('Chrome was not found. Install it, or set CHROME_BIN to its executable.');
  return found;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Keys by the names the checks use. Shift+Equal types '+', as on a US keyboard.
const KEYS = {Escape: [27, 'Escape'], Space: [32, 'Space', ' '], Tab: [9, 'Tab'], Enter: [13, 'Enter', '\r'], Backspace: [8, 'Backspace'],
  Home: [36, 'Home'], End: [35, 'End'], PageUp: [33, 'PageUp'], PageDown: [34, 'PageDown'],
  ArrowLeft: [37, 'ArrowLeft'], ArrowUp: [38, 'ArrowUp'], ArrowRight: [39, 'ArrowRight'], ArrowDown: [40, 'ArrowDown'],
  Minus: [189, 'Minus', '-'], Equal: [187, 'Equal', '=']};
const SHIFTED = {Equal: '+', Minus: '_'};

export async function openBrowser({width = 1400, height = 900} = {}) {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'ptp-chrome-'));
  const child = spawn(findChrome(), ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--mute-audio', '--window-size=' + width + ',' + height, 'about:blank'], {stdio: 'ignore'});
  // Port 0 lets Chrome pick a free port, so runs never collide; it writes the port into the profile.
  let endpoint;
  for (let i = 0; i < 150 && !endpoint; i++) { await sleep(100); try { const [port, ws] = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n'); if (ws) endpoint = 'ws://127.0.0.1:' + port + ws; } catch {} }
  if (!endpoint) { child.kill(); throw new Error('Chrome did not start'); }
  const ws = new WebSocket(endpoint); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let next = 1; const pending = new Map(), listeners = new Set();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } else for (const l of listeners) l(m); };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = next++; pending.set(id, {resolve, reject}); ws.send(JSON.stringify({id, method, params, sessionId})); });
  const version = (await send('Browser.getVersion')).product;

  // Without width and height a page keeps the window's own viewport (1400 × 813 at the default window size);
  // with them it is exactly that size.
  async function page({browserContextId, width: w, height: h, colorScheme, reducedMotion, init = []} = {}) {
    const {targetId} = await send('Target.createTarget', {url: 'about:blank', ...(browserContextId ? {browserContextId} : {})});
    const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
    const log = {console: [], errors: [], requests: [], failed: []}, routes = [], waiters = new Set(), pendingRequests = new Map();
    const listener = m => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.exceptionThrown') log.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Log.entryAdded') log.console.push(m.params.entry.level + ': ' + m.params.entry.text);
      if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) log.console.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
      if (m.method === 'Network.requestWillBeSent') {
        const {requestId, request, initiator} = m.params;
        log.requests.push(request.url);
        // Failure reports may become CI artifacts. Keep local user paths, queries and Blob identifiers out.
        const u = new URL(request.url);
        const url = u.protocol === 'blob:' || u.protocol === 'data:' ? u.protocol :
          u.protocol === 'file:' ? 'file:…/' + u.pathname.split('/').pop() : u.origin + u.pathname;
        pendingRequests.set(requestId, {url, initiator: initiator?.type});
      }
      if (m.method === 'Network.loadingFailed') {
        const {requestId, errorText, type, canceled, blockedReason} = m.params;
        log.failed.push({...pendingRequests.get(requestId), type, errorText, canceled: Boolean(canceled), blockedReason});
        pendingRequests.delete(requestId);
      }
      if (m.method === 'Network.loadingFinished') pendingRequests.delete(m.params.requestId);
      if (m.method === 'Fetch.requestPaused') {
        const route = routes.find(r => m.params.request.url.endsWith(r.suffix)), requestId = m.params.requestId;
        const go = method => s(method, method === 'Fetch.failRequest' ? {requestId, errorReason: 'Failed'} : {requestId}).catch(() => {});
        route ? route.handler({url: m.params.request.url, continue: () => go('Fetch.continueRequest'), fail: () => go('Fetch.failRequest')}) : go('Fetch.continueRequest');
      }
      for (const w of waiters) if (w.method === m.method) { waiters.delete(w); w.resolve(m.params); }
    };
    listeners.add(listener);
    const s = (method, params) => send(method, params, sessionId);
    for (const d of ['Page', 'Runtime', 'Network', 'Log', 'Performance']) await s(d + '.enable');
    // The timer is cleared when the event comes, or it would keep Node running for its full length after the last page.
    const event = (method, seconds = 90) => { let w, timer; const p = new Promise((resolve, reject) => { w = {method, resolve: v => { clearTimeout(timer); resolve(v); }}; waiters.add(w); timer = setTimeout(() => { if (waiters.delete(w)) reject(new Error('Timed out waiting for ' + method)); }, seconds * 1000); }); return p; };
    const evaluate = async (expression) => { const r = await s('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, userGesture: true}); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    const call = (fn, ...args) => evaluate(`(${fn})(...${JSON.stringify(args)})`);
    const viewport = (vw, vh) => s('Emulation.setDeviceMetricsOverride', {width: vw, height: vh, deviceScaleFactor: 1, mobile: false});
    // Emulated preferences merge: changing the colour scheme keeps reduced motion, and the other way round.
    const features = {};
    const media = ({colorScheme: c, reducedMotion: r} = {}) => { if (c) features['prefers-color-scheme'] = c; if (r) features['prefers-reduced-motion'] = r;
      return s('Emulation.setEmulatedMedia', {features: Object.entries(features).map(([name, value]) => ({name, value}))}); };
    if (w && h) await viewport(w, h);
    if (colorScheme || reducedMotion) await media({colorScheme, reducedMotion});
    const addInit = source => s('Page.addScriptToEvaluateOnNewDocument', {source: typeof source === 'function' ? `(${source})()` : source});
    for (const source of init) await addInit(source);
    async function waitFor(expression, seconds = 90) {
      const start = Date.now();
      for (;;) { let v; try { v = await evaluate(expression); } catch {} if (v) return (Date.now() - start) / 1000; if (Date.now() - start > seconds * 1000) throw new Error('Timed out waiting for ' + expression.slice(0, 200)); await sleep(50); }
    }
    // Real input: waits until the element is visible, enabled and still, then clicks its centre with the mouse.
    // With text, the first element matching selector whose text (spaces collapsed) matches that pattern.
    async function press(selector, {text = null, seconds = 30} = {}) {
      const start = Date.now(); let box, last;
      for (;;) {
        box = await call((sel, pattern) => { const e = pattern === null ? document.querySelector(sel) : [...document.querySelectorAll(sel)].find(x => new RegExp(pattern).test(x.textContent.replace(/\s+/g, ' ').trim()));
          if (!e) return null; e.scrollIntoView({block: 'center', inline: 'center'}); const r = e.getBoundingClientRect(), st = getComputedStyle(e);
          return {x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, ok: r.width > 0 && r.height > 0 && st.visibility === 'visible' && !e.disabled && !e.closest('fieldset:disabled')}; }, selector, text);
        if (box?.ok && last && box.x === last.x && box.y === last.y) break;
        last = box;
        if (Date.now() - start > seconds * 1000) throw new Error('Not clickable: ' + selector + ' ' + JSON.stringify(box));
        await sleep(30);
      }
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await s('Input.dispatchMouseEvent', {type, x: box.x, y: box.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1});
    }
    async function key(combo) {
      const parts = combo.split('+'), name = parts.pop(), shift = parts.includes('Shift');
      const [code, codeName, plain] = KEYS[name] || [name.toUpperCase().charCodeAt(0), 'Key' + name.toUpperCase(), name];
      const text = shift ? SHIFTED[name] ?? plain?.toUpperCase() : plain, modifiers = shift ? 8 : 0;
      const k = {key: text ?? codeName, code: codeName, windowsVirtualKeyCode: code, modifiers};
      if (shift) await s('Input.dispatchKeyEvent', {type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, modifiers});
      await s('Input.dispatchKeyEvent', {type: text ? 'keyDown' : 'rawKeyDown', ...k, ...(text ? {text, unmodifiedText: plain} : {})});
      await s('Input.dispatchKeyEvent', {type: 'keyUp', ...k});
      if (shift) await s('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, modifiers: 0});
    }
    const focus = selector => call(sel => { const e = document.querySelector(sel); if (!e) throw Error('Missing ' + sel); e.focus(); return true; }, selector);
    async function fill(selector, text) {
      await call(sel => { const e = document.querySelector(sel); if (!e) throw Error('Missing ' + sel); e.focus(); e.select?.(); return true; }, selector);
      if (text) await s('Input.insertText', {text}); else await key('Backspace');
    }
    const select = (selector, value) => call((sel, v) => { const e = document.querySelector(sel); if (!e) throw Error('Missing ' + sel);
      if (![...e.options].some(o => o.value === v)) throw Error(sel + ' has no option ' + v);
      e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); return true; }, selector, value);
    const visible = selector => call(sel => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility === 'visible'; }, selector);
    const disabled = selector => call(sel => { const e = document.querySelector(sel); if (!e) throw Error('Missing ' + sel); return e.disabled === true || Boolean(e.closest('fieldset:disabled')); }, selector);
    async function screenshot(file, {clip, fullPage} = {}) {
      if (fullPage) { const size = await evaluate('({width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight})'); clip = {x: 0, y: 0, ...size}; }
      const {data} = await s('Page.captureScreenshot', {format: 'png', ...(clip ? {clip: {...clip, scale: 1}, captureBeyondViewport: Boolean(fullPage)} : {})});
      const buffer = Buffer.from(data, 'base64'); if (file) writeFileSync(file, buffer); return buffer;
    }
    // Requests whose address ends with suffix go to handler(request), which calls request.continue() or request.fail(), now or later.
    async function route(suffix, handler) { routes.push({suffix, handler}); await s('Fetch.enable', {patterns: routes.map(r => ({urlPattern: '*' + r.suffix, requestStage: 'Request'}))}); }
    async function unroute(suffix) { routes.splice(0, routes.length, ...routes.filter(r => r.suffix !== suffix)); await (routes.length ? s('Fetch.enable', {patterns: routes.map(r => ({urlPattern: '*' + r.suffix, requestStage: 'Request'}))}) : s('Fetch.disable')); }
    async function goto(url, {until} = {}) { const done = until && event(until === 'load' ? 'Page.loadEventFired' : 'Page.domContentEventFired'); await s('Page.navigate', {url}); if (done) await done; }
    async function reload({until} = {}) { const done = until && event(until === 'load' ? 'Page.loadEventFired' : 'Page.domContentEventFired'); await s('Page.reload', {}); if (done) await done; }
    return {log, send: s, evaluate, call, goto, reload, waitFor, press, key, focus, fill, select, visible, disabled, screenshot, route, unroute, viewport, media, addInit,
      url: () => evaluate('location.href'),
      async metrics() { const {metrics} = await s('Performance.getMetrics'); return Object.fromEntries(metrics.map(m => [m.name, m.value])); },
      // A script click; press() is the real mouse click.
      async click(selector) { return evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.scrollIntoView({block:'center'});e.click();return true})()`); },
      async close() { listeners.delete(listener); await send('Target.closeTarget', {targetId}).catch(() => {}); }};
  }
  async function context() {
    const {browserContextId} = await send('Target.createBrowserContext', {disposeOnDetach: true});
    return {page: options => page({...options, browserContextId}), close: () => send('Target.disposeBrowserContext', {browserContextId}).catch(() => {})};
  }
  return {page, context, sleep, version, async close() { try { await send('Browser.close'); } catch {} child.kill(); await sleep(300); try { rmSync(profile, {recursive: true, force: true}); } catch {} }};
}
