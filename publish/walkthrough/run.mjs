// node publish/walkthrough/run.mjs [--file | --hosted] [--only=name,name]
//
// Uses the built viewer in a headless Chrome the way a visitor does, and says plainly what is wrong. Opened from
// disk it runs every check below; served from a web-host style subfolder on this computer (hosted) it runs the
// ones that loading over HTTP can change. It needs Chrome (set CHROME_BIN if it is somewhere unusual) and the
// packages from `npm ci` in rebuild/ (axe-core). Results and a few pictures go to rebuild/build/walkthrough/.
import {readFileSync, writeFileSync, mkdirSync, createReadStream, statSync, realpathSync} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {openBrowser} from './chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), kit = path.resolve(here, '../..');
const view = path.join(kit, 'view'), out = path.join(kit, 'rebuild/build/walkthrough');
const config = JSON.parse(readFileSync(path.join(kit, 'rebuild/config/model.json'), 'utf8'));
const axeSource = readFileSync(path.join(kit, 'rebuild/node_modules/axe-core/axe.min.js'), 'utf8');
const args = process.argv.slice(2), only = args.find(a => a.startsWith('--only='))?.slice(7).split(',');
const protocols = args.includes('--file') ? ['file'] : args.includes('--hosted') ? ['hosted'] : ['file', 'hosted'];
mkdirSync(out, {recursive: true});

// A small read-only server on this computer only, so the page can be tried the way a web host serves it.
const root = realpathSync(view), prefix = '/demo/player/';
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, name.startsWith(prefix) ? name.slice(prefix.length) || 'index.html' : '\0');
  try { if (!file.startsWith(root + path.sep) || !statSync(file).isFile()) throw 0; res.writeHead(200, {'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript'}); createReadStream(file).pipe(res); }
  catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const urls = {file: pathToFileURL(path.join(view, 'index.html')).href, hosted: 'http://127.0.0.1:' + server.address().port + prefix};
const browser = await openBrowser(), sleep = browser.sleep;

// ---- helpers

const expect = (ok, what) => { if (!ok) throw Error(what); };
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
const contexts = new Set();   // every page a check opens; closed after the check, whatever happened
/** Opens the page in a fresh browser context, in front (a page behind others stops animating), and waits until it
 *  is ready or has given up on 3D. */
async function open(url, {width = 1280, height = 800, scheme = 'light', init = [], before} = {}) {
  const context = await browser.context();
  contexts.add(context);
  const page = await context.page({width, height, colorScheme: scheme, reducedMotion: 'reduce', init});
  page.done = () => { contexts.delete(context); return context.close(); };
  await page.send('Page.bringToFront');
  if (before) await before(page);
  await page.goto(url, {until: 'load'});
  await page.waitFor(`document.getElementById('shell').getAttribute('aria-busy')==='false'||window.portableTapePlayerError`, 90);
  return page;
}
/** What the viewer reports about itself. */
const look = page => page.evaluate(`(()=>{const s=window.portableTapePlayer.snapshot(),r=JSON.parse(document.getElementById('stage').dataset.test||'null');
  return {state:s.state,audio:s.audio,loaded:s.loaded,lettering:s.lettering,controls:s.controls,diagnostics:s.diagnostics,packageErrors:s.packageErrors,
    visible:s.parts.filter(p=>p.visible).length,phase:s.parts.find(p=>p.id==='MEC-011')?.phase,render:r,drawer:document.body.dataset.drawer,solo:document.body.classList.contains('solo')}})()`);
/** Waits until the viewer's state passes test (a function of look()), or fails with what. */
async function until(page, test, what, seconds = 20) {
  const start = Date.now();
  for (;;) { const now = await look(page); if (test(now)) return now; if (Date.now() - start > seconds * 1000) throw Error(what + ' (state: ' + JSON.stringify(now.state).slice(0, 300) + ')'); await sleep(100); }
}
const shown = (page, selector) => page.visible(selector);
/** Sets a slider or other input as a person would, with its input event. */
const setInput = (page, id, value) => page.call((id, value) => { const e = document.getElementById(id); e.value = value; e.dispatchEvent(new Event('input', {bubbles: true})); return true; }, id, String(value));
const text = (page, id) => page.evaluate(`document.getElementById(${JSON.stringify(id)})?.textContent.trim()`);
/** Where a point of the model (mm) is on the screen now. */
const toScreen = (page, point) => page.call(p => {
  const c = window.portableTapePlayer.snapshot({appearance: true}).appearanceInvariant.camera, [qx, qy, qz, qw] = c.quaternion;
  const v = [p[0] - c.position[0], p[1] - c.position[1], p[2] - c.position[2]];
  // rotate by the camera's inverse quaternion, then project
  const x = -qx, y = -qy, z = -qz, w = qw, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  const e = [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x], m = c.projectionMatrix;
  const X = m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12], Y = m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13], W = m[3] * e[0] + m[7] * e[1] + m[11] * e[2] + m[15];
  const r = document.getElementById('canvas').getBoundingClientRect();
  return {x: r.left + (X / W + 1) / 2 * r.width, y: r.top + (1 - Y / W) / 2 * r.height};
}, point);
const mouse = (page, type, {x, y}, held = false) => page.send('Input.dispatchMouseEvent', {type, x, y, button: 'left', buttons: held ? 1 : 0, clickCount: 1});
async function clickAt(page, p) { await mouse(page, 'mouseMoved', p); await mouse(page, 'mousePressed', p, true); await mouse(page, 'mouseReleased', p); await sleep(150); }
/** The words the model shows under the pointer at p. */
async function hintAt(page, p) { await mouse(page, 'mouseMoved', p); await sleep(150); return page.evaluate(`document.getElementById('controlHint').hidden?'':document.getElementById('controlHint').textContent`); }
async function drag(page, a, b) {
  await mouse(page, 'mouseMoved', a); await mouse(page, 'mousePressed', a, true);
  for (let i = 1; i <= 8; i++) await mouse(page, 'mouseMoved', {x: a.x + (b.x - a.x) * i / 8, y: a.y + (b.y - a.y) * i / 8}, true);
  await mouse(page, 'mouseReleased', b); await sleep(150);
}
/** Where a plug's tip sits in a socket and at its mouth, and where its grip sits when plugged in: the mouth of the
 *  socket lies between the first two, and the grip is what to click to pull the plug out. */
const plugPoints = (page, key, socket) => page.call((assembly, socket) => {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const moving = window.portableTapePlayerData.model.meta.parts.filter(p => p.assembly === assembly && p.plugPoses?.[socket])
    .map(p => p.plugPoses[socket]).filter(([mouth, seated]) => d(mouth[0], seated[0]) > .01);
  const tip = moving.reduce((a, b) => Math.hypot(...b[1][0]) < Math.hypot(...a[1][0]) ? b : a), seated = tip[1][0];
  const grip = moving.map(p => p[1][0]).filter(p => d(p, seated) < 25).reduce((a, b) => d(b, seated) > d(a, seated) ? b : a);
  return {seated, mouth: tip[0][0], grip};
}, config.accessories.plugs[key].assembly, socket);
const cellPoint = page => page.call(assembly => {
  const b = window.portableTapePlayerData.model.meta.parts.find(p => p.assembly === assembly).authoritativeBounds;
  return b.min.map((v, i) => (v + b.max[i]) / 2);
}, config.accessories.assemblies.find(a => !Object.values(config.accessories.plugs).some(p => p.assembly === a)));
/** Runs axe's colour-contrast rule on the page as it is now. */
async function contrast(page, label) {
  if (!await page.evaluate('Boolean(window.axe)')) await page.evaluate(axeSource + ';true');   // through the debugging connection: no network, no CSP change
  const bad = await page.evaluate(`window.axe.run(document,{runOnly:{type:'rule',values:['color-contrast']}}).then(r=>r.violations.flatMap(v=>v.nodes.map(n=>n.target.join(' ')+': '+n.failureSummary.split('\\n').pop().trim())))`);
  expect(!bad.length, label + ': text too faint to read: ' + bad.slice(0, 4).join('; '));
}

// ---- the checks. Each opens its own page; file: true runs from disk, hosted: true from the web-style server.

const CHECKS = {
  async opens(url, protocol) {
    const page = await open(url);
    await until(page, s => s.render?.draws > 0 && s.render.triangles > 0, 'the model is never drawn');
    await page.press('button[data-drawer=parts]');   // Parts reads every part, so every geometry file loads
    const s = await until(page, s => ['exterior', 'cassette', 'mechanism', 'electronics'].every(n => s.loaded.includes(n)), 'not every geometry file loads', 60);
    expect(!s.packageErrors.length, 'a geometry file failed: ' + s.packageErrors.join('; '));
    expect(!page.log.errors.length, 'the page threw: ' + page.log.errors[0]?.split('\n')[0]);
    expect(!page.log.console.some(l => l.startsWith('error')), 'the console shows an error: ' + page.log.console.find(l => l.startsWith('error')));
    expect(!page.log.failed.length, 'a request failed: ' + JSON.stringify(page.log.failed[0]));
    const origin = protocol === 'file' ? 'file:' : new URL(url).origin, outside = page.log.requests.filter(u => !/^(blob|data):/.test(u) && !u.startsWith(origin));
    expect(!outside.length, 'the page reached outside its own folder: ' + outside[0]);
    expect(!s.diagnostics.violations.length && !s.diagnostics.errors.length, 'the page broke its own content rules: ' + JSON.stringify([...s.diagnostics.violations, ...s.diagnostics.errors][0]));
    await page.press('#closeDrawer');
    if (protocol === 'file') await page.screenshot(path.join(out, 'desktop.png'));
    await page.done();
  },
  async rows(url) {
    const page = await open(url);
    const measure = () => page.evaluate(`(()=>{const line=bar=>{const items=[],walk=el=>{for(const c of el.children){const st=getComputedStyle(c);if(st.display==='contents'){walk(c);continue}if(st.position!=='absolute'&&c.getClientRects().length)items.push(c)}};walk(bar);
      const mids=items.map(c=>{const r=c.getBoundingClientRect();return r.top+r.height/2});return {spread:Math.max(...mids)-Math.min(...mids),overflow:bar.scrollWidth-bar.clientWidth}};
      return {top:line(document.querySelector('header')),bottom:line(document.querySelector('footer')),page:document.documentElement.scrollWidth-innerWidth,stage:document.getElementById('stage').offsetHeight/innerHeight}})()`);
    for (const [w, h] of [[1440, 900], [1180, 760], [1000, 720], [939, 700], [900, 700], [768, 1024], [640, 800], [520, 800], [390, 844], [320, 640]]) {
      await page.viewport(w, h); await sleep(250);
      const m = await measure();
      for (const row of ['top', 'bottom']) expect(m[row].spread < 4 && m[row].overflow <= 1, `${w} px wide: the ${row} row does not fit on one line`);
      expect(m.page <= 1, `${w} px wide: the page scrolls sideways`);
      expect(m.stage > .5, `${w} px wide: the model has only ${Math.round(m.stage * 100)}% of the height`);
      if (w < 940) {   // the sound, volume and tone are in the More menu
        await page.press('#moreControls');
        expect(await shown(page, '#volumeLeft') && await shown(page, '#tone') && await shown(page, '#audioSource') && await shown(page, '#exteriorVersion'), `${w} px wide: the More menu does not hold the sound, volume, tone and version`);
        await page.press('#moreControls');
      }
      if (w === 390) await page.screenshot(path.join(out, 'phone.png'));
    }
    await page.done();
  },
  async views(url) {
    const page = await open(url);
    for (const v of ['service', 'exploded', 'catalog', 'assembled']) {
      await page.press(`button[data-view=${v}]`);
      await until(page, s => s.state.view === v && s.render?.view === v && s.render.settled, 'the ' + v + ' view does not show', 60);
      expect(await page.disabled('button[data-mode=play]') === ['exploded', 'catalog'].includes(v), v + ': play should work only while the player is together');
      if (v === 'exploded') { expect(await shown(page, '#toggleLabels'), 'the exploded view has no Labels switch'); await page.screenshot(path.join(out, 'exploded.png')); }
    }
    await page.viewport(800, 800); await sleep(250);   // in a narrow window the views are a menu
    await page.select('#viewMenu', 'exploded'); await until(page, s => s.state.view === 'exploded', 'the view menu does not change the view');
    await page.done();
  },
  async drawers(url) {
    const page = await open(url);
    for (const name of ['explore', 'parts', 'about']) {
      await page.press(`button[data-drawer=${name}]`);
      const s = await look(page);
      expect(s.drawer === name && await shown(page, `.panel[data-panel=${name}]`), name + ' does not open');
      expect(s.state.uiMode === (name === 'parts' ? 'inspect' : 'operate'), name + ': a click on the model should ' + (name === 'parts' ? 'pick a part' : 'work the player'));
      await page.press(`button[data-drawer=${name}]`);
      expect((await look(page)).drawer === '', name + ' does not close');
    }
    await page.press('button[data-drawer=about]'); await page.key('Escape');
    expect((await look(page)).drawer === '', 'Escape does not close the drawer');
    await page.done();
  },
  async transport(url) {
    const page = await open(url);
    await page.press('button[data-mode=play]');
    const a = await until(page, s => s.state.mode === 'play', 'play does not start');
    await sleep(500);
    expect((await look(page)).phase !== a.phase, 'play starts but nothing turns');
    for (const mode of ['ff', 'rew']) { await page.press(`button[data-mode=${mode}]`); await until(page, s => s.state.mode === mode, mode + ' does not start'); }
    await page.press('#eject'); await until(page, s => s.state.mode === 'stop' && !s.state.stopCycle, 'stop does not stop');
    await page.done();
  },
  async actions(url) {
    const page = await open(url);
    await page.press('#actionsButton'); expect(await shown(page, '#actionsMenu'), 'the Actions menu does not open');
    const step = async (selector, test, what) => { await page.press(selector); return until(page, test, what); };
    await step('#door', s => s.state.door, 'Open cassette door does not open it');
    expect(await text(page, 'door') === 'Close cassette door', 'the door item does not say what it will do next');
    await step('#door', s => !s.state.door, 'Close cassette door does not close it');
    await step('#cassette', s => s.state.door && s.state.media === 'removed', 'Remove cassette does not open the door and take the cassette out');
    await step('#cassette', s => s.state.media === 'loaded', 'Put cassette in does not put it back');
    await step('#door', s => !s.state.door, 'the door does not close again');
    await step('#cells', s => s.state.batteryOpen && s.state.cells, 'Put batteries in does not open the cover and put them in');
    await step('#cells', s => !s.state.cells, 'Remove batteries does not take them out');
    await step('#batteryDoor', s => !s.state.batteryOpen, 'Close battery cover does not close it');
    const before = (await look(page)).visible;
    await step('#accessories', s => s.state.accessories && s.visible > before, 'Show accessories shows nothing');
    for (const [key, value] of [['headphones', 'A'], ['headphones', 'B'], ['adapter', 'DC IN'], ['headphones', 'out'], ['adapter', 'out']]) {
      await page.select(`select[data-plug=${key}]`, value); await until(page, s => s.state[key] === value, `the ${key} do not go to ${value}`);
    }
    await step('#accessories', s => !s.state.accessories, 'Hide accessories does not hide them');
    const box = await page.call(() => { const r = document.getElementById('hotline').getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; });
    await mouse(page, 'mouseMoved', box); await mouse(page, 'mousePressed', box, true); await sleep(150);
    expect((await look(page)).state.hotline, 'holding Hot Line does not press it');
    await mouse(page, 'mouseReleased', box); await sleep(150);
    expect(!(await look(page)).state.hotline, 'letting go of Hot Line does not release it');
    await page.key('Escape'); expect(!await shown(page, '#actionsMenu'), 'Escape does not close the Actions menu');
    await page.done();
  },
  async model(url) {
    // The same actions with the mouse on the model itself.
    const page = await open(url);
    let s = await look(page);
    await clickAt(page, s.controls['EXT-030']); await until(page, s => s.state.door, 'clicking the door on the model does not open it');
    await clickAt(page, (await look(page)).controls['EXT-030']); await until(page, s => !s.state.door, 'clicking the open door does not close it');
    for (const [key, socket, words] of [['headphones', 'A', 'socket A'], ['headphones', 'B', 'socket B'], ['adapter', 'DC IN', 'DC IN']]) {
      await page.press('button[data-view=assembled]'); await sleep(300);
      const {seated, mouth, grip} = await plugPoints(page, key, socket);
      let at = null;   // the socket's opening, found between where the plug's tip ends and where it starts
      for (const f of [0, .2, .4, .6, .8]) {
        const p = await toScreen(page, seated.map((v, i) => v + (mouth[i] - v) * f));
        if ((await hintAt(page, p)).includes(words)) { at = p; break; }
      }
      expect(at, `the model does not offer to plug the ${key} into ${socket}`);
      await clickAt(page, at); await until(page, s => s.state[key] === socket, `clicking ${socket} on the model does not plug the ${key} in`);
      await sleep(300); const g = await toScreen(page, grip);
      expect(/out/.test(await hintAt(page, g)), `the ${key} plug does not offer to come out`);
      await clickAt(page, g); await until(page, s => s.state[key] === 'out', `clicking the ${key} plug does not pull it out`);
    }
    await page.press('#actionsButton'); await page.press('#batteryDoor'); await page.key('Escape');
    await page.press('button[data-drawer=explore]'); await page.press('[data-angle=back]'); await sleep(400);
    const cell = await toScreen(page, await cellPoint(page));
    s = await look(page);
    for (const cells of [!s.state.cells, s.state.cells]) {
      expect(/batteries/.test(await hintAt(page, cell)), 'the battery case does not offer to ' + (cells ? 'take' : 'give') + ' the batteries');
      await clickAt(page, cell); await until(page, s => s.state.cells === cells, 'clicking in the battery case does not move the batteries');
    }
    // Sony's own controls: from the close-up, the play key and a volume grip.
    await page.select('#controlCamera', 'transport'); await sleep(600);
    s = await look(page);
    await clickAt(page, s.controls['CTL-03']); await until(page, s => s.state.mode === 'play', 'pressing play on the model does not play');
    const [a, b] = s.controls['CTL-05'].axis, along = f => ({x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f});
    let grip = null;   // the grip's visible knob, found along its travel
    for (const f of [0, .15, .3, .45, .6]) if (/drag/.test(await hintAt(page, along(f)))) { grip = f; break; }
    expect(grip !== null, 'the left volume grip does not offer to be dragged');
    await drag(page, along(grip), along(grip + .35));
    s = await look(page);
    expect(!near(s.state.volumeLeft, .5, .01), 'dragging the left volume grip does not change the volume');
    expect(near(+await page.evaluate(`document.getElementById('volumeLeft').value`), s.state.volumeLeft, .011), 'the left volume slider does not follow the grip');
    await page.done();
  },
  async sound(url) {
    const page = await open(url);
    let s = await look(page);
    expect(await page.evaluate(`document.getElementById('audioSource').value`) === 'music' && s.state.audioEnabled, 'the page does not open with the music chosen');
    await page.press('button[data-mode=play]');   // the first press starts the sound
    await until(page, s => s.audio.state === 'playing' && s.audio.music.playing, 'pressing play does not play the music', 30);
    await page.select('#audioSource', 'tone'); await until(page, s => s.audio.state === 'playing' && /test signal/.test(s.audio.message), 'the test tone does not play');
    await setInput(page, 'volumeRight', .2); await page.select('#tone', 'low');
    s = await look(page);
    expect(near(s.state.volumeRight, .2, 1e-9) && s.state.tone === 'low', 'the volume slider or the tone choice does not reach the player');
    await page.select('#audioSource', 'music');
    await page.press('button[data-drawer=explore]'); await page.press('#reset');
    expect((await look(page)).state.audioEnabled && await page.evaluate(`document.getElementById('audioSource').value`) === 'music', 'Reset changes the sound choice');
    await page.select('#audioSource', 'mute'); await until(page, s => !s.state.audioEnabled && s.audio.state === 'off', 'Mute does not silence it');
    await page.done();
  },
  async parts(url) {
    const page = await open(url);
    await page.press('button[data-drawer=parts]');
    await page.fill('#search', '8-835-008-11'); await sleep(300);
    expect(/8-835-008-11/.test(await text(page, 'serviceResults')), "searching for a Sony part number finds nothing");
    await page.fill('#search', 'MEC-011'); await page.press('#results button', {text: '^MEC-011 ·'});
    expect(await text(page, 'partId') === 'MEC-011', 'picking a search result does not show the part');
    await page.press('#isolate'); await until(page, s => s.state.isolate && s.visible === 1, 'Isolate part does not show the part alone');
    await page.press('#closeDrawer');
    await until(page, s => s.drawer === '' && s.state.isolate && s.visible === 1, 'closing Parts does not keep the part on its own');
    expect(await shown(page, '#showAll'), 'with Parts closed there is no way to show all parts');
    await page.press('#showAll'); await until(page, s => !s.state.isolate && s.visible > 50, 'Show all parts does not bring the rest back');
    expect(!await shown(page, '#showAll'), 'Show all parts stays after use');
    await page.done();
  },
  async fullscreen(url) {
    const page = await open(url);
    await page.press('#fullscreen');
    let m = await page.evaluate(`({solo:document.body.classList.contains('solo'),header:document.querySelector('header').getClientRects().length,stage:document.getElementById('stage').offsetHeight,h:innerHeight})`);
    expect(m.solo && !m.header && m.stage >= m.h - 1, 'full screen does not show the model alone');
    await page.key('Escape'); await sleep(300);
    expect(!(await look(page)).solo, 'Escape does not leave full screen');
    await page.press('#fullscreen'); await page.press('#fullscreen');
    expect(!(await look(page)).solo, 'the X does not leave full screen');
    await page.done();
  },
  async versions(url) {
    const page = await open(url);
    const ids = await page.evaluate(`[...document.getElementById('exteriorVersion').options].map(o=>o.value)`);
    expect(ids.length === 3, 'there are not three exterior versions');
    for (const id of ids) {
      await page.select('#exteriorVersion', id); await sleep(200);
      const wrong = (await look(page)).lettering.filter(line => { const [, versions, state] = line.split(' '); return versions.split('+').includes(id) !== (state === 'shown'); });
      expect(!wrong.length, id + ': the wrong lettering shows: ' + wrong.slice(0, 3).join(', '));
    }
    await page.done();
  },
  async tour(url) {
    const page = await open(url);
    await page.press('button[data-drawer=explore]'); await page.press('#tour');
    await until(page, s => s.state.tour === 0 && s.state.uiMode === 'tour', 'the tour does not start');
    expect(await shown(page, '#story') && await shown(page, '#tourNext'), 'the tour shows no caption');
    await page.press('#tourNext'); await until(page, s => s.state.tour === 1, 'Next does not move the tour on');
    await page.press('#tour'); await until(page, s => s.state.tour === -1 && s.state.uiMode === 'operate', 'End tour does not end it');
    expect(!await shown(page, '#story'), 'the caption stays after the tour');
    await page.done();
  },
  async contrast(url) {
    for (const scheme of ['light', 'dark']) {
      const page = await open(url, {scheme});
      await contrast(page, scheme + ', the page');
      await page.press('button[data-drawer=parts]'); await page.fill('#search', 'MEC-011'); await page.press('#results button', {text: '^MEC-011 ·'});
      await contrast(page, scheme + ', a part in Parts');
      await page.press('button[data-drawer=about]'); await page.press('#actionsButton');
      await contrast(page, scheme + ', About and the Actions menu');
      if (scheme === 'dark') await page.screenshot(path.join(out, 'dark.png'));
      await page.done();
    }
  },
  async 'no-3d'(url) {
    const page = await open(url, {init: ['HTMLCanvasElement.prototype.getContext = () => null;']});
    expect(await text(page, 'loadingTitle') === '3D unavailable; parts catalog available.', 'without 3D the page does not say so');
    expect((await page.evaluate('document.body.dataset.drawer')) === 'parts' && await shown(page, '#loadingRetry'), 'without 3D the parts list is not offered');
    await page.fill('#search', 'motor'); await sleep(300);
    expect(await page.evaluate(`document.querySelectorAll('#results .part-result').length`) > 0, 'without 3D the search finds nothing');
    await page.done();
  },
  async 'missing-file'(url) {
    const page = await open(url, {before: p => p.route('geometry/mechanism.js', r => r.fail())});
    await page.press('button[data-drawer=parts]');
    await page.waitFor(`document.getElementById('loadingTitle').textContent==='3D unavailable; parts catalog available.'`, 30);
    expect(await shown(page, '#loadingRetry'), 'a missing file offers no reload');
    await page.fill('#search', 'motor'); await sleep(300);
    expect(await page.evaluate(`document.querySelectorAll('#results .part-result').length`) > 0, 'with a file missing the search finds nothing');
    await page.done();
  },
};
const WHERE = {opens: ['file', 'hosted'], sound: ['file', 'hosted'], 'missing-file': ['hosted']};

// ---- run

const results = [], started = Date.now();
try {
  for (const protocol of protocols) for (const [name, check] of Object.entries(CHECKS)) {
    if (!(WHERE[name] || ['file']).includes(protocol) || (only && !only.includes(name))) continue;
    const start = Date.now(), result = {check: name, protocol, passed: true};
    try { await check(urls[protocol], protocol); } catch (error) { result.passed = false; result.error = String(error.message || error).split('\n')[0]; }
    for (const context of contexts) await context.close();
    contexts.clear();
    result.seconds = +((Date.now() - start) / 1000).toFixed(1);
    results.push(result);
    console.log(`${result.passed ? 'ok   ' : 'WRONG'} ${name.padEnd(13)} ${protocol.padEnd(6)} ${String(result.seconds).padStart(5)} s${result.error ? '  ' + result.error : ''}`);
  }
} finally { await browser.close(); server.close(); }
const passed = results.length > 0 && results.every(r => r.passed), seconds = +((Date.now() - started) / 1000).toFixed(1);
writeFileSync(path.join(out, 'summary.json'), JSON.stringify({passed, seconds, browser: browser.version, platform: process.platform + ' ' + process.arch, results}, null, 1) + '\n');
console.log(`\n${passed ? 'The viewer passes' : 'The viewer FAILS'} ${results.length} checks in ${seconds} s (${browser.version}). Pictures and results: rebuild/build/walkthrough/.`);
process.exitCode = passed ? 0 : 1;
