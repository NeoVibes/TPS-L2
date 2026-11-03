// Walks the page through the viewer's main functions and writes down what it sees at each stop:
// views, door, eject, battery cover, volume, tone, separation, search, part copy, both cassettes,
// audio, then PLAY, FF and REW. Run by run.mjs, which compares the record with the reference.
//   mainSteps(browser, page file or http address, record.json[, screenshot prefix])
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {renderedView} from './checks.mjs';

export default async function mainSteps(browser, target, out, shotPrefix) {
  const url = target.startsWith('http') ? target : pathToFileURL(target).href;
  const record = {steps: {}};
  try {
    const page = await browser.page({width: 1400, height: 813}), E = page.evaluate, wait = browser.sleep;
    await page.goto(url);
    record.ready_seconds = await page.waitFor('window.portableTapePlayer && window.portableTapePlayer.snapshot().ready', 90);
    const clickText = text => E(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.replace(/\\s+/g,' ').trim().includes(${JSON.stringify(text)})&&!b.disabled);if(!b)return false;b.click();return true})()`);
    const setValue = (id, value) => E(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)return false;e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    const snap = () => E(`(()=>{const s=window.portableTapePlayer.snapshot();const r=v=>typeof v==='number'?Math.round(v*1e4)/1e4:v;const walk=o=>Array.isArray(o)?o.map(walk):o&&typeof o==='object'?Object.fromEntries(Object.entries(o).map(([k,v])=>[k,walk(v)])):r(o);return {state:walk(s.state),loaded:[...(s.loaded||[])].sort(),packageErrors:s.packageErrors,controls:walk(s.controls),parts:JSON.stringify(walk(s.parts))}})()`);
    const text = id => E(`document.getElementById(${JSON.stringify(id)})?.textContent?.replace(/\\s+/g,' ').trim().slice(0,160)`);
    // A slow renderer can repeat one snapshot while the camera, loading, or mechanism is still moving.
    // Wait for a completed final render after the action, then compare the original full-pose fingerprint.
    const render = "JSON.parse(document.getElementById('stage').dataset.test || 'null')";
    async function settled(name, action, requiredPackages, view) {
      const before = action ? await E(`(${render})?.frames || 0`) : 0;
      if (action && await action() === false) throw Error(name + ': control unavailable');
      if (requiredPackages) await renderedView(page, {}, requiredPackages, view);
      await page.waitFor(`(r => r?.frames > ${before} && r.settled)(${render})`, 90);
      const {parts, ...rest} = await snap();
      record.steps[name] = {...rest, positions: createHash('sha256').update(parts).digest('hex').slice(0, 12), status: await text('status') ?? null, packageStatus: await text('packageStatus')};
    }
    await settled('start', null, ['exterior', 'cassette'], 'assembled');
    if (shotPrefix) await page.screenshot(shotPrefix + '-start.png');
    await settled('service view', () => clickText('Service view'), ['exterior', 'cassette', 'mechanism', 'electronics'], 'service');
    if (shotPrefix) await page.screenshot(shotPrefix + '-service.png');
    await settled('exploded', () => clickText('Exploded assembly'));
    await settled('all components', () => clickText('All components'));
    await settled('assembled again', () => clickText('Assembled'));
    await settled('stop pressed', () => page.click('#eject'));
    await settled('door open', () => page.click('#door'));
    await settled('eject with door open', () => page.click('#eject'));
    await settled('door closed', () => page.click('#door'));
    await settled('battery cover open', () => page.click('#batteryDoor'));
    if (shotPrefix) await page.screenshot(shotPrefix + '-battery.png');
    await settled('battery cover closed', () => page.click('#batteryDoor'));
    await settled('volume moved', async () => { await setValue('volumeLeft', 0.85); return setValue('volumeRight', 0.2); });
    record.steps.toneOptions = await E(`[...document.getElementById('tone').options].map(o=>o.value)`);
    await settled('tone changed', () => setValue('tone', record.steps.toneOptions[0]));
    await settled('separation 60', () => setValue('spread', 60));
    await settled('separation 0', () => setValue('spread', 0));
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
    for (const v of record.steps.cassetteOptions) await settled('cassette ' + v, () => setValue('cassetteVariant', v));
    await page.click('#audioEnable'); await page.waitFor("window.portableTapePlayer.snapshot().audio.state === 'ready'", 30); record.steps.audio = await text('audioStatus');
    await setValue('tapePosition', 0.5); await wait(200);   // mid-side, so that REW below has tape to wind back
    const transportRendered = mode => page.waitFor(`(${render})?.mode === ${JSON.stringify(mode)}`, 30);
    await clickText('PLAY'); await transportRendered('play');
    const a = await snap(), frame = await E(`(${render}).frames`);
    await page.waitFor(`(${render}).frames > ${frame}`, 30);
    const b = await snap();
    record.steps.play = {mode: a.state.mode, partsAreMoving: a.parts !== b.parts};
    await clickText('FF'); await transportRendered('ff'); record.steps.ff = {mode: (await snap()).state.mode};
    await clickText('REW'); await transportRendered('rew'); record.steps.rew = {mode: (await snap()).state.mode};
    await page.click('#eject'); await page.waitFor(`(r => r?.mode === 'stop' && !r.stopCycle)(${render})`, 30); record.steps.stopAfterRun = {mode: (await snap()).state.mode};
    const m = await page.metrics();
    record.heapMB = Math.round(m.JSHeapUsedSize / 1e6);
    record.requests = page.log.requests.map(u => decodeURIComponent(u).replace(/^.*\/(view|publish|Portable Tape Player[^/]*)\//, '').replace(/^.*\//, '').replace(/^data:.{0,30}.*/, 'data:'));
    record.failed = page.log.failed; record.errors = page.log.errors.map(e => e.split('\n')[0]); record.console = page.log.console;
  } catch (e) { record.crashed = String(e.stack || e); }
  writeFileSync(out, JSON.stringify(record, null, 1) + '\n');
}
