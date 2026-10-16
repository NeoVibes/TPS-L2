// Presses every other control once (tour, projection, sections, categories, labels, camera angles,
// close-ups, keys, Hot Line, …) and records the viewer's state after each. Run by run.mjs.
//   node control-steps.mjs <page file or http address> <record.json>
import {openBrowser} from './chrome.mjs';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
const [target, out] = process.argv.slice(2);
const browser = await openBrowser({port: 9336});
const record = {steps: {}};
try {
  const page = await browser.page(), E = page.evaluate, wait = browser.sleep;
  await page.goto(target.startsWith('http') ? target : pathToFileURL(target).href);
  await page.waitFor('window.portableTapePlayer && window.portableTapePlayer.snapshot().ready', 90);
  const state = () => E(`(()=>{const s=window.portableTapePlayer.snapshot().state;const r=v=>typeof v==='number'?Math.round(v*100)/100:v;const o={};for(const k in s){if(!/tapePosition|tapeRevision|stopTravel/.test(k))o[k]=r(s[k]);}return o})()`);
  const step = async (name, js, pause = 350) => { let result; try { result = typeof js === 'function' ? await js() : await E(js); } catch (e) { result = 'THREW ' + String(e.message).slice(0, 120); } await wait(pause); record.steps[name] = {result: result ?? null, state: await state(), errors: page.log.errors.length}; };
  const click = sel => `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'missing';e.click();return 'ok'})()`;
  const set = (id, v) => `(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)return 'missing';e.value=${JSON.stringify(String(v))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return [...(e.options||[])].map(o=>o.value).join(',')||'ok'})()`;
  const key = (target, k, extra = '') => `(()=>{const t=${target};t.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true${extra}}));return 'ok'})()`;
  await step('workmode tour', click('[data-workmode="tour"]'));
  await step('tour start', click('#tour'), 900);
  await step('tour next', click('#tourNext'), 700);
  await step('tour pause', click('#tourPause'));
  await step('tour seek 30', set('tourSeek', 30), 700);
  await step('tour seek 62', set('tourSeek', 62), 700);
  await step('reset', click('#reset'), 700);
  await step('workmode inspect', click('[data-workmode="inspect"]'));
  for (const v of ['orthographic', 'perspective']) await step('projection ' + v, set('projection', v));
  const sections = await E(`[...document.getElementById('section').options].map(o=>o.value)`);
  for (const v of sections.slice(0, 4)) await step('section ' + v, set('section', v));
  await step('section offset', set('sectionOffset', 12));
  await step('section back', set('section', sections[0]));
  const subsystems = await E(`[...document.getElementById('subsystem').options].map(o=>o.value)`);
  for (const v of subsystems.slice(0, 4)) await step('subsystem ' + v, set('subsystem', v), 500);
  await step('subsystem back', set('subsystem', subsystems[0]));
  const categories = await E(`[...document.querySelectorAll('[data-category]')].map(b=>b.dataset.category)`);
  for (const c of categories.slice(0, 6)) await step('category ' + c, click('[data-category="' + c + '"]'), 500);
  await step('labels toggle', click('#toggleLabels'));
  await step('labels toggle back', click('#toggleLabels'));
  await step('fit view', click('#homeCamera'));
  const angles = await E(`[...document.querySelectorAll('[data-angle]')].map(b=>b.dataset.angle)`);
  for (const a of angles) await step('angle ' + a, click('[data-angle="' + a + '"]'));
  const closeups = await E(`[...document.getElementById('controlCamera').options].map(o=>o.value)`);
  for (const c of closeups.slice(0, 4)) await step('close-up ' + c, set('controlCamera', c));
  await step('search motor', set('search', 'motor')); await step('pick first result', click('.part-result'), 500);
  await step('focus part', click('#focus')); await step('isolate', click('#isolate')); await step('isolate off', click('#isolate'));
  await step('show all', click('#clearContext')); await step('close inspector', click('#closeInspector'));
  await step('inspect cassette', click('#inspectCassette'), 700);
  await step('part link', `(()=>{location.hash='part=CTL-04';return 'ok'})()`, 600);
  await step('workmode operate', click('[data-workmode="operate"]'));
  await step('view service', click('[data-view="service"]'), 600); await step('view exploded', click('[data-view="exploded"]'), 600); await step('view assembled', click('[data-view="assembled"]'), 600);
  await step('pause', click('#pause')); await step('pause again', click('#pause'));
  await step('motion cues off', `(()=>{const e=document.getElementById('motionCues');e.click();return e.checked})()`);
  await step('speed', set('speed', 0.9)); await step('tape position', set('tapePosition', 0.4));
  await step('remove cassette', click('#door'), 600); await step('cassette out', click('#cassette'), 700); await step('cassette in', click('#cassette'), 700); await step('door shut', click('#door'), 600);
  await step('hot line down', `(()=>{const e=document.getElementById('hotline');e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1}));return 'ok'})()`);
  await step('hot line up', `(()=>{const e=document.getElementById('hotline');e.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}));window.dispatchEvent(new Event('blur'));return 'ok'})()`);
  for (const k of [' ', 'Escape', 'ArrowRight', 'ArrowLeft', 'p', 'f', 'r', '/', 'Enter']) await step('document key ' + JSON.stringify(k), key('document', k));
  for (const k of ['ArrowLeft', 'ArrowUp', '+', '-', 'Home', 'Enter']) await step('canvas key ' + JSON.stringify(k), key(`document.getElementById('canvas')`, k));
  await step('performance', click('#performance')); await step('retry assets', click('#retryAssets'));
  await step('visibility', `(()=>{document.dispatchEvent(new Event('visibilitychange'));return 'ok'})()`);
  await step('pointer on model', async () => {
    const {x, y} = await E(`(()=>{const r=document.getElementById('canvas').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await page.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x, y});
    await page.send('Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', clickCount: 1});
    await page.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', clickCount: 1});
    return 'ok';
  }, 500);
  record.errors = page.log.errors.map(e => e.split('\n')[0]); record.console = page.log.console;
} catch (e) { record.crashed = String(e.stack || e); }
finally { await browser.close(); }
writeFileSync(out, JSON.stringify(record, null, 1) + '\n');
console.log('control steps | steps', Object.keys(record.steps).length, '| errors', (record.errors || []).length, (record.errors || []).slice(0, 3).map(e => e.split('\n')[0]), '| missing controls', Object.entries(record.steps).filter(([, v]) => v.result === 'missing').map(([k]) => k), record.crashed ? 'CRASHED ' + record.crashed.slice(0, 200) : '');
