// Walks the page through the viewer's main functions and writes down what it sees at each stop:
// views, door, eject, battery cover, volume, tone, separation, search, part copy, both cassettes,
// audio, then PLAY, FF and REW. Run by run.mjs, which compares the record with the reference.
//   node main-steps.mjs <page file or http address> <record.json> [screenshot prefix]
import {openBrowser} from './chrome.mjs';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const [target, out, shotPrefix] = process.argv.slice(2);
const url = target.startsWith('http') ? target : pathToFileURL(target).href;
const browser = await openBrowser();
const record = {steps: {}};
try {
  const page = await browser.page(), E = page.evaluate, wait = browser.sleep;
  await page.goto(url);
  record.ready_seconds = await page.waitFor('window.portableTapePlayer && window.portableTapePlayer.snapshot().ready', 90);
  const clickText = text => E(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.replace(/\\s+/g,' ').trim().includes(${JSON.stringify(text)})&&!b.disabled);if(!b)return false;b.click();return true})()`);
  const setValue = (id, value) => E(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)return false;e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  const snap = () => E(`(()=>{const s=window.portableTapePlayer.snapshot();const r=v=>typeof v==='number'?Math.round(v*1e4)/1e4:v;const walk=o=>Array.isArray(o)?o.map(walk):o&&typeof o==='object'?Object.fromEntries(Object.entries(o).map(([k,v])=>[k,walk(v)])):r(o);return {state:walk(s.state),loaded:[...(s.loaded||[])].sort(),packageErrors:s.packageErrors,controls:walk(s.controls),parts:JSON.stringify(walk(s.parts))}})()`);
  const text = id => E(`document.getElementById(${JSON.stringify(id)})?.textContent?.replace(/\\s+/g,' ').trim().slice(0,160)`);
  // Waits until the model stops moving, then records its state and a fingerprint of every part's position.
  async function settled(name, {moving = false} = {}) {
    let last, s;
    for (let i = 0; i < 60; i++) { await wait(250); s = await snap(); if (moving || s.parts === last) break; last = s.parts; }
    const {parts, ...rest} = s;
    record.steps[name] = {...rest, positions: moving ? '(moving)' : createHash('sha256').update(parts).digest('hex').slice(0, 12), status: await text('status') ?? null, packageStatus: await text('packageStatus')};
    return s;
  }
  await settled('start');
  if (shotPrefix) await page.screenshot(shotPrefix + '-start.png');
  await clickText('Service view'); await page.waitFor(`window.portableTapePlayer.snapshot().loaded.length>=3`, 60).catch(()=>{}); await settled('service view');
  if (shotPrefix) await page.screenshot(shotPrefix + '-service.png');
  await clickText('Exploded assembly'); await settled('exploded');
  await clickText('All components'); await settled('all components');
  await clickText('Assembled'); await settled('assembled again');
  await page.click('#eject'); await settled('stop pressed');
  await page.click('#door'); await settled('door open');
  await page.click('#eject'); await settled('eject with door open');
  await page.click('#door'); await settled('door closed');
  await page.click('#batteryDoor'); await settled('battery cover open');
  if (shotPrefix) await page.screenshot(shotPrefix + '-battery.png');
  await page.click('#batteryDoor'); await settled('battery cover closed');
  await setValue('volumeLeft', 0.85); await setValue('volumeRight', 0.2); await settled('volume moved');
  record.steps.toneOptions = await E(`[...document.getElementById('tone').options].map(o=>o.value)`);
  await setValue('tone', record.steps.toneOptions[0]); await settled('tone changed');
  await setValue('spread', 60); await settled('separation 60');
  await setValue('spread', 0); await settled('separation 0');
  await clickText('Inspect'); await wait(400);
  await setValue('search', '8-835-008-11'); await wait(500);
  record.steps.searchMotor = await E(`[...document.querySelectorAll('.part-result,.service-result,[class*=result]')].slice(0,8).map(b=>b.textContent.replace(/\\s+/g,' ').trim().slice(0,70))`);
  await setValue('search', '3-568-726-00'); await wait(500);
  record.steps.searchStop = await E(`[...document.querySelectorAll('.part-result,.service-result,[class*=result]')].slice(0,8).map(b=>b.textContent.replace(/\\s+/g,' ').trim().slice(0,70))`);
  await E(`(()=>{const b=[...document.querySelectorAll('.part-result,.service-result,[class*=result]')][0];if(b)b.click()})()`); await wait(600);
  await clickText('STOP EJECT cap'); await wait(400);
  record.steps.inspector = {partId: await text('partId'), partName: await text('partName')};
  await page.click('#copyPartLink'); await wait(300);
  record.steps.copy = {button: await text('copyPartLink'), fallback: await E(`document.getElementById('copyFallback')?.value||''`)};
  await clickText('Operate'); await wait(300);
  record.steps.cassetteOptions = await E(`[...document.getElementById('cassetteVariant').options].map(o=>o.value)`);
  for (const v of record.steps.cassetteOptions) { await setValue('cassetteVariant', v); await settled('cassette ' + v); }
  await page.click('#audioEnable'); await wait(500); record.steps.audio = await text('audioStatus');
  await clickText('PLAY'); await wait(900); const a = await snap(); await wait(600); const b = await snap();
  record.steps.play = {mode: a.state.mode, partsAreMoving: a.parts !== b.parts};
  await clickText('FF'); await wait(700); record.steps.ff = {mode: (await snap()).state.mode};
  await clickText('REW'); await wait(700); record.steps.rew = {mode: (await snap()).state.mode};
  await page.click('#eject'); await wait(900); record.steps.stopAfterRun = {mode: (await snap()).state.mode};
  const m = await page.metrics();
  record.heapMB = Math.round(m.JSHeapUsedSize / 1e6);
  record.requests = page.log.requests.map(u => decodeURIComponent(u).replace(/^.*\/(view|publish|Portable Tape Player[^/]*)\//, '').replace(/^.*\//, '').replace(/^data:.{0,30}.*/, 'data:'));
  record.failed = page.log.failed; record.errors = page.log.errors.map(e => e.split('\n')[0]); record.console = page.log.console;
} catch (e) { record.crashed = String(e.stack || e); }
finally { await browser.close(); }
writeFileSync(out, JSON.stringify(record, null, 1) + '\n');
console.log('main steps | ready', record.ready_seconds, 's | heap', record.heapMB, 'MB | errors', (record.errors||[]).length, '| console', (record.console||[]).length, '| requests', [...new Set(record.requests||[])].join(', '), record.crashed ? '| CRASHED ' + record.crashed.slice(0, 300) : '');
