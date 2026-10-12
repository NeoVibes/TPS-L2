// Walks through the exterior versions: each choice shows exactly its own lettering; switching leaves
// the camera, the transport, the covers, the cassette, the view and the selection as they were;
// reset, tours and view changes keep the choice; links carry it; the inspector and the parts list
// follow it; and it is harmless when 3D graphics are unavailable. Run by run.mjs.
//   node exterior-steps.mjs <page file or http address>
import {openBrowser} from './chrome.mjs';
import {pathToFileURL} from 'node:url';

const target = process.argv[2], url = target.startsWith('http') ? target : pathToFileURL(target).href;
const expect = (ok, what) => { console.log((ok ? 'ok    ' : 'WRONG ') + what); if (!ok) process.exitCode = 1; };
const browser = await openBrowser({port: 9338});
try {
  let page = await browser.page(), E = page.evaluate; const wait = browser.sleep;
  const ready = () => page.waitFor('window.portableTapePlayer && window.portableTapePlayer.snapshot().ready', 90);
  await page.goto(url); await ready(); await wait(1200);
  const choose = v => E(`(()=>{const e=document.getElementById('exteriorVersion');e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const click = selector => E(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const text = id => E(`document.getElementById(${JSON.stringify(id)})?.textContent?.replace(/\\s+/g,' ').trim()`);
  // What the page shows: its state, how many parts are visible, where every part is, and where the controls sit on screen.
  const look = () => E(`(()=>{const s=window.portableTapePlayer.snapshot();const r=v=>Math.round(v*100)/100;return {state:s.state,lettering:s.lettering,visible:s.parts.filter(p=>p.visible).length,
    parts:JSON.stringify(s.parts.map(p=>[p.id,p.visible,p.position.map(r),p.quaternion.map(r)])),screen:JSON.stringify(Object.entries(s.controls).map(([k,c])=>c&&[k,Math.round(c.x),Math.round(c.y)])),hash:location.hash}})()`);
  // Covers and views ease into place; wait until three looks in a row are the same.
  const settle = async () => { let last, steady = 0; for (let i = 0; i < 60 && steady < 2; i++) { await wait(250); const seen = await look(), now = seen.parts + seen.screen; steady = now === last ? steady + 1 : 0; last = now; } };

  // ---- the choice itself
  const options = await E(`[...document.getElementById('exteriorVersion').options].map(o=>[o.value,o.textContent])`);
  const versions = options.map(o => o[0]);
  expect(versions.length === 3 && versions[0] === 'later', 'three versions are offered and Later comes first');
  expect(options.every(o => /about/.test(o[1]) && o[1].split(' · ').length === 3), 'each choice names its lettering and an approximate serial range');
  expect(/lettering/i.test(await text('exteriorNote')), 'the line beneath says to go by the lettering');
  expect(await E(`(()=>{const e=document.getElementById('exteriorVersion');return e.labels.length===1&&e.tabIndex===0&&e.getAttribute('aria-describedby')==='exteriorNote'})()`), 'the choice is labelled and reachable with the keyboard');
  for (const mode of ['tour', 'inspect', 'operate']) { await click('[data-workmode="' + mode + '"]'); await wait(300); expect(await E(`document.getElementById('exteriorVersion').offsetParent!==null`), 'the choice is visible in ' + mode + ' mode'); }
  await click('#reset'); await settle();
  let s = await look();
  expect(s.state.exterior === 'later' && !s.hash.includes('exterior'), 'a fresh session shows Later, and the address says nothing about it');

  // ---- each choice shows exactly its own lettering
  for (const v of [...versions.slice(1), versions[0]]) {
    await choose(v); await wait(400); s = await look();
    const wrong = s.lettering.filter(line => { const [, tags, shown] = line.split(' '); return (shown === 'shown') !== tags.split('+').includes(v); });
    expect(s.state.exterior === v && s.lettering.length >= 8 && !wrong.length, v + ': exactly its own lettering is shown (' + s.lettering.filter(l => l.endsWith(' shown')).length + ' of ' + s.lettering.length + ' version-specific pieces)' + (wrong.length ? ' WRONG: ' + wrong[0] : ''));
    expect(v === 'later' ? !s.hash.includes('exterior') : s.hash.includes('exterior=' + v), v + ': the address ' + (v === 'later' ? 'drops' : 'carries') + ' the choice');
  }
  // Keyboard: with the choice focused, typing a letter picks the version that starts with it.
  await E(`document.getElementById('exteriorVersion').focus()`);
  for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', {type, key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69, text: type === 'keyDown' ? 'e' : undefined});
  await wait(500); s = await look();
  expect(s.state.exterior === 'early', 'typing E in the focused choice selects Early');
  await choose('later'); await wait(300);

  // ---- switching changes nothing else, in every state
  const same = (a, b, moving) => {
    const strip = st => Object.fromEntries(Object.entries(st).filter(([k]) => k !== 'exterior' && !(moving && /^(tapePosition|tapeRevision)$/.test(k))));
    const reasons = [];
    if (JSON.stringify(strip(a.state)) !== JSON.stringify(strip(b.state))) reasons.push('state');
    if (a.visible !== b.visible) reasons.push('visible parts ' + a.visible + ' → ' + b.visible);
    if (!moving && a.parts !== b.parts) reasons.push('part positions');
    if (!moving && a.screen !== b.screen) reasons.push('camera');
    return reasons;
  };
  const states = [
    ['stopped, assembled', async () => {}, false],
    ['playing', async () => { await click('button[data-mode="play"]'); await wait(900); }, true],
    ['after STOP / EJECT', async () => { await click('#eject'); await settle(); }, false],
    ['door open', async () => { await click('#door'); await settle(); }, false],
    ['door open, STOP / EJECT pressed', async () => { await click('#eject'); await settle(); }, false],
    ['battery cover open', async () => { await click('#door'); await settle(); await click('#batteryDoor'); await settle(); }, false],
    ['service view', async () => { await click('#batteryDoor'); await settle(); await click('[data-view="service"]'); await page.waitFor('window.portableTapePlayer.snapshot().loaded.length>=3', 60); await settle(); }, false],
    ['exploded view', async () => { await click('[data-view="exploded"]'); await settle(); }, false],
    ['all components', async () => { await click('[data-view="catalog"]'); await settle(); }, false],
    ['a section cut', async () => { await click('[data-view="assembled"]'); await E(`(()=>{const e=document.getElementById('section');e.value='x';e.dispatchEvent(new Event('change',{bubbles:true}))})()`); await settle(); }, false],
    ['a part isolated', async () => { await E(`(()=>{const e=document.getElementById('section');e.value='off';e.dispatchEvent(new Event('change',{bubbles:true}))})()`); await click('[data-workmode="inspect"]'); await E(`location.hash='part=EXT-030'`); await wait(900); await click('#isolate'); await settle(); }, false],
    ['the guided tour, paused', async () => { await click('#isolate'); await click('#closeInspector'); await click('#tour'); await wait(1200); await click('#tourPause'); await settle(); }, false],
  ];
  let turn = 0;
  for (const [name, enter, moving] of states) {
    await enter();
    const before = await look(), to = versions[1 + turn++ % 2];
    await choose(to); await (moving ? wait(300) : settle());
    const after = await look(), reasons = same(before, after, moving);
    expect(after.state.exterior === to && !reasons.length, 'switching to ' + to + ' while ' + name + ' changes nothing else' + (reasons.length ? ' WRONG: ' + reasons.join(', ') : ''));
    if (name === 'a part isolated') expect(after.visible === 1 && after.state.selectedId === 'EXT-030', 'the isolated part stays isolated and selected');
  }
  // Reset, a view change and starting the tour keep the choice.
  await choose('early'); await click('#reset'); await settle();
  expect((await look()).state.exterior === 'early', 'Reset keeps the chosen version');
  await click('[data-view="service"]'); await settle(); expect((await look()).state.exterior === 'early', 'a view change keeps it');
  await click('#tour'); await wait(1000); expect((await look()).state.exterior === 'early', 'starting the tour keeps it'); await click('#tour'); await click('#reset'); await settle();

  // ---- the inspector and the parts list follow the choice
  await click('[data-workmode="inspect"]'); await E(`location.hash='part=EXT-030&exterior=intermediate'`); await wait(1200);
  s = await look();
  expect(s.state.exterior === 'intermediate' && s.state.selectedId === 'EXT-030', 'an address can name a part and a version together');
  expect(/Intermediate and early exterior · Confirmation level/.test(await text('partConfirmation')) && (await text('partConfirmation')).match(/Confirmation level/g).length === 1, 'the inspector shows the level of the lettering on screen');
  expect(/X-3568-711-0/.test(await text('partService')) && !/X-3568-711-2/.test(await text('partService')), 'and the service-manual number of that lid');
  await choose('later'); await wait(500);
  expect(/Later exterior · Confirmation level/.test(await text('partConfirmation')) && /X-3568-711-2/.test(await text('partService')) && !/X-3568-711-0/.test(await text('partService')), 'changing the version changes both');
  expect((await look()).hash.includes('part=EXT-030') && !(await look()).hash.includes('exterior'), 'the address keeps the part and drops the default version');
  await E(`(()=>{document.getElementById('masterList').open=true;const e=document.getElementById('masterSearch');e.value='EXT-030';e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await wait(300);
  const rows = await E(`[...document.querySelectorAll('#masterResults .master-row')].map(b=>b.textContent)`);
  expect(rows.length === 2 && rows.some(r => r.includes('later exterior')) && rows.some(r => r.includes('intermediate and early exterior')), 'the parts list has a row for each lettering of the lid');
  await E(`[...document.querySelectorAll('#masterResults .master-row')].find(b=>b.textContent.includes('intermediate and early exterior')).click()`); await wait(900);
  expect((await look()).state.exterior === 'intermediate', 'picking a row shows a version that has that lettering');
  await click('#copyPartLink'); await wait(200);
  expect(page.log.errors.length === 0, 'no script errors' + (page.log.errors.length ? ': ' + page.log.errors[0].split('\n')[0] : ''));
  const outside = page.log.requests.filter(u => !u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith(new URL(url).origin));
  expect(outside.length === 0, 'nothing was requested from outside');
  await page.close();

  // ---- a link that names a version opens with it
  page = await browser.page(); E = page.evaluate;
  await page.goto(url + '#exterior=early'); await ready(); await wait(1200);
  s = await E(`(()=>{const s=window.portableTapePlayer.snapshot();return {exterior:s.state.exterior,select:document.getElementById('exteriorVersion').value,shown:s.lettering.filter(l=>l.endsWith(' shown')).every(l=>l.split(' ')[1].split('+').includes('early'))}})()`);
  expect(s.exterior === 'early' && s.select === 'early' && s.shown, 'a link ending in #exterior=early opens the Early version');
  await page.close();

  // ---- without 3D graphics the choice does no harm and the information follows it
  page = await browser.page(); E = page.evaluate;
  await page.send('Page.addScriptToEvaluateOnNewDocument', {source: 'HTMLCanvasElement.prototype.getContext = () => null;'});
  await page.goto(url); await page.waitFor('window.portableTapePlayerError', 60);
  await E(`(()=>{const e=document.getElementById('exteriorVersion');e.value='early';e.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('masterList').open=true;const f=document.getElementById('masterSearch');f.value='EXT-010';f.dispatchEvent(new Event('input',{bubbles:true}))})()`); await wait(300);
  await E(`[...document.querySelectorAll('#masterResults .master-row')].find(b=>b.textContent.includes('early exterior')).click()`); await wait(300);
  const info = await E(`document.getElementById('partConfirmation').textContent`);
  expect(/Early exterior · Confirmation level/.test(info) && page.log.errors.length === 0, 'without graphics: the choice works and the part information follows it');
  await page.close();
} catch (e) { console.log('WRONG the exterior steps did not finish: ' + String(e.stack || e).split('\n')[0]); process.exitCode = 1; }
finally { await browser.close(); }
