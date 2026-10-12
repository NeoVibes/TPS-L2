// Drives an installed Chrome, headless, over its debugging connection. No extra packages.
// Chrome is found through CHROME_BIN, then the usual install places.
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {existsSync} from 'node:fs';
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

export async function openBrowser({port = 9333, width = 1400, height = 900} = {}) {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'ptp-chrome-'));
  const child = spawn(findChrome(), ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--mute-audio', '--window-size=' + width + ',' + height, 'about:blank'], {stdio: 'ignore'});
  let info;
  for (let i = 0; i < 100 && !info; i++) { await sleep(100); try { info = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json(); } catch {} }
  if (!info) { child.kill(); throw new Error('Chrome did not start'); }
  const ws = new WebSocket(info.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let next = 1; const pending = new Map(), listeners = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } else for (const l of listeners) l(m); };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = next++; pending.set(id, {resolve, reject}); ws.send(JSON.stringify({id, method, params, sessionId})); });
  async function page() {
    const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
    const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
    const log = {console: [], errors: [], requests: [], failed: []};
    listeners.push(m => { if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.exceptionThrown') log.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Log.entryAdded') log.console.push(m.params.entry.level + ': ' + m.params.entry.text);
      if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) log.console.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
      if (m.method === 'Network.requestWillBeSent') log.requests.push(m.params.request.url);
      if (m.method === 'Network.loadingFailed') log.failed.push(m.params.errorText + ' ' + (m.params.blockedReason || '')); });
    const s = (method, params) => send(method, params, sessionId);
    for (const d of ['Page', 'Runtime', 'Network', 'Log', 'Performance']) await s(d + '.enable');
    const evaluate = async (expression) => { const r = await s('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, userGesture: true}); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    return {log, send: s, evaluate, goto: url => s('Page.navigate', {url}),
      async waitFor(expression, seconds = 90) { const start = Date.now(); for (;;) { let v; try { v = await evaluate(expression); } catch {} if (v) return (Date.now() - start) / 1000; if (Date.now() - start > seconds * 1000) throw new Error('Timed out waiting for ' + expression); await sleep(150); } },
      async screenshot(file) { const {data} = await s('Page.captureScreenshot', {format: 'png'}); writeFileSync(file, Buffer.from(data, 'base64')); },
      async metrics() { const {metrics} = await s('Performance.getMetrics'); return Object.fromEntries(metrics.map(m => [m.name, m.value])); },
      async click(selector) { return evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.scrollIntoView({block:'center'});e.click();return true})()`); },
      close: () => send('Target.closeTarget', {targetId})};
  }
  return {page, sleep, async close() { try { await send('Browser.close'); } catch {} child.kill(); await sleep(300); try { rmSync(profile, {recursive: true, force: true}); } catch {} }};
}
