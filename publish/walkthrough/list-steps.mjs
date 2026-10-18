// Walks through the parts list in Inspect: filters by level and status, picking a part, a cassette
// row and an unmodelled entry, the confirmation block, the submission text, the CSV download and
// the keyboard. Then opens the page again with 3D graphics switched off and checks that the list,
// the search and part information still work. Run by run.mjs.
//   node list-steps.mjs <page file or http address> <view folder>
import {openBrowser} from './chrome.mjs';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const [target, view] = process.argv.slice(2);
const url = target.startsWith('http') ? target : pathToFileURL(target).href;
const csv = readFileSync(path.join(view, 'master-parts.csv'), 'utf8'), lines = csv.trim().split('\n').length - 1;
const expect = (ok, what) => { console.log((ok ? 'ok    ' : 'WRONG ') + what); if (!ok) process.exitCode = 1; };
const browser = await openBrowser({port: 9337});
try {
  for (const graphics of [true, false]) {
    const page = await browser.page(), E = page.evaluate, wait = browser.sleep;
    if (!graphics) await page.send('Page.addScriptToEvaluateOnNewDocument', {source: 'HTMLCanvasElement.prototype.getContext = () => null;'});
    await page.goto(url);
    if (graphics) await page.waitFor('window.portableTapePlayer && window.portableTapePlayer.snapshot().ready', 90);
    else await page.waitFor('window.portableTapePlayerError', 60);
    const text = id => E(`document.getElementById(${JSON.stringify(id)})?.textContent?.replace(/\\s+/g,' ').trim()`);
    const set = (id, value) => E(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    const rows = () => E(`[...document.querySelectorAll('#masterResults .master-row')].map(b=>b.textContent)`);
    const clickRow = n => E(`document.querySelectorAll('#masterResults .master-row')[${n}].click()`);
    const filter = async (search, status, level) => { await set('masterSearch', search); await set('masterStatus', status); await set('masterLevel', level); await wait(150); return text('masterCount'); };
    const label = graphics ? '' : 'without graphics: ';
    await E(`document.getElementById('masterList').open = true`);

    if (!graphics) {
      expect(await text('loadingTitle') === 'The viewer could not start', label + 'the page says the 3D view could not start');
      expect(/graphics unavailable/.test(await text('searchCount')), label + 'the component search still answers');
    }
    expect((await filter('', '', '')).startsWith('Showing 60 of ' + lines + ' rows'), label + 'the list holds every row of master-parts.csv (' + lines + ')');
    const modelled = Number((await filter('', 'modelled', '')).split(' ')[3]), missing = Number((await filter('', 'not modelled', '')).split(' ')[3]);
    expect(modelled + missing === lines && missing > 0, label + 'status filter: ' + modelled + ' modelled, ' + missing + ' not modelled');
    expect(Number((await filter('', '', '0')).split(' ')[3]) === missing, label + 'level 0 is exactly the unmodelled entries');
    expect(Number((await filter('', '', '1')).split(' ')[3]) + Number((await filter('', '', '0')).split(' ')[3]) <= lines, label + 'level filter');

    // An unmodelled entry: its detail and the report action.
    await filter('', 'not modelled', ''); await clickRow(0); await wait(150);
    expect(/Confirmation level 0/.test(await text('masterDetail')) && /Not modelled/.test(await text('masterDetail')), label + 'an unmodelled entry shows level 0');
    // With a repository address a submission button opens that repository's issue form; without one it offers text to copy.
    const pressed = async id => { await E(`(()=>{window.__opened=[];window.open=u=>{window.__opened.push(String(u));return null};document.getElementById(${JSON.stringify(id)}).click()})()`); await wait(100); return E(`window.__opened`); };
    const form = (opened, template) => opened.length === 1 && new RegExp('^https://github\\.com/[\\w.-]+/[\\w.-]+/issues/new\\?template=' + template + '\\.yml(&part=[^&]+)?$').test(opened[0]);
    const reported = await pressed('masterReport'), report = await E(`document.querySelector('#masterSubmission textarea').value`);
    if (reported.length) expect(form(reported, 'part'), label + 'the report button opens the issue form (' + reported[0] + ')');
    else expect(report.startsWith('New or corrected part') && /hide serial numbers/.test(report) && !(await E(`document.getElementById('masterSubmission').hidden`)), label + 'with no repository set, the submission text is offered for copying');

    // A modelled part.
    expect((await filter('BAY-052', '', '')).startsWith('Showing 1 of 1'), label + 'filtering by part ID finds one row');
    await clickRow(0); await wait(graphics ? 900 : 200);
    expect(await text('partId') === 'BAY-052', label + 'picking the row opens the part');
    const block = await text('partConfirmation');
    expect(/Confirmation level 1/.test(block) && /overall geometry: 1 \(not assessed\)/.test(block) && /capstan\.diameter \((pass|fail|no check)\)/.test(block), label + 'the inspector shows its level, features and targets');
    const confirmed = await pressed('confirmPart'), confirm = await E(`document.querySelector('#partSubmission textarea').value`);
    if (confirmed.length) expect(form(confirmed, 'confirmation') && confirmed[0].endsWith('&part=BAY-052'), label + 'the confirm button opens the issue form for the part (' + confirmed[0] + ')');
    else expect(confirm.startsWith('Confirmation\nPart ID: BAY-052') && /remove location data/.test(confirm), label + 'the confirmation text names the part and carries the privacy reminder');
    expect((await E('location.hash')).includes('part=BAY-052'), label + 'the address still carries the part link');

    // A cassette part has a row for each cassette.
    expect((await filter('MEDIA-001', '', '')).startsWith('Showing 2 of 2'), label + 'a cassette part has two rows');
    const cassette = await rows();
    expect(cassette.some(r => r.includes('original cassette')) && cassette.some(r => r.includes('detailed cassette')), label + 'each row says which cassette it is');
    await clickRow(cassette.findIndex(r => r.includes('original cassette'))); await wait(graphics ? 900 : 200);
    expect((await text('partConfirmation')).match(/Confirmation level/g)?.length === 2, label + 'the inspector shows both cassettes\' levels');

    if (graphics) {
      const s = await E(`(()=>{const s=window.portableTapePlayer.snapshot();return {selected:s.state.selectedId,variant:s.state.cassetteVariant,mode:s.state.uiMode,select:document.getElementById('cassetteVariant').value}})()`);
      expect(s.selected === 'MEDIA-001' && s.variant === 'original' && s.select === 'original' && s.mode === 'inspect', 'picking the original cassette row selects the part and shows that cassette');
      await E(`document.getElementById('isolate').click()`); await wait(500);
      expect(await E(`window.portableTapePlayer.snapshot().parts.filter(p=>p.visible).length`) === 1, 'isolating the picked part still works');
      await E(`document.getElementById('isolate').click()`);
      // The download hands over the same bytes as view/master-parts.csv.
      await E(`(()=>{window.__handed=null;const make=URL.createObjectURL;URL.createObjectURL=b=>{b.text().then(t=>window.__handed=t);return make.call(URL,b)}})()`);
      await E(`document.getElementById('masterDownload').click()`); await wait(400);
      expect(await E('window.__handed') === csv, 'the download is view/master-parts.csv, byte for byte');
      // Keyboard: a row is a button; Enter on it picks it.
      await filter('CTL-05', '', '');
      expect(await E(`(()=>{const b=document.querySelector('#masterResults .master-row');b.focus();return b.tagName==='BUTTON'&&b.tabIndex===0&&document.activeElement===b})()`), 'rows can be reached with the keyboard');
      for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', {type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined});
      await wait(700);
      expect(await text('partId') === 'CTL-05', 'Enter on a row picks it');
      expect(await E(`['masterSearch','masterStatus','masterLevel'].every(id=>{const e=document.getElementById(id);return e.getAttribute('aria-label')||e.labels?.length})`), 'the filters are labelled');
      // The older search is untouched.
      await set('search', '8-835-008-11'); await wait(400);
      expect(await E(`document.querySelectorAll('#results .part-result').length`) > 0, 'the component search still finds a service part number');
    }
    expect(await E(`document.querySelectorAll('#levelKey li').length`) === 7, label + 'the seven levels are explained');
    const outside = page.log.requests.filter(u => !u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith(new URL(url).origin));
    expect(outside.length === 0, label + 'nothing was requested from outside');
    expect(page.log.errors.length === (graphics ? 0 : 0), label + 'no script errors' + (page.log.errors.length ? ': ' + page.log.errors[0].split('\n')[0] : ''));
    await page.close();
  }
} catch (e) { console.log('WRONG the parts-list steps did not finish: ' + String(e.stack || e).split('\n')[0]); process.exitCode = 1; }
finally { await browser.close(); }
