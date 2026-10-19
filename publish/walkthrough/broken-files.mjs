// Opens separate copies with missing, cut-short and altered geometry. Each failure
// is diagnosed independently because a required-package failure stops further loads.
// Repair the file and exercise the recovery action offered by the actual UI.
//   node broken-files.mjs <view folder> <scratch folder>
import {openBrowser} from './chrome.mjs';
import {pathToFileURL} from 'node:url';
import {cpSync, rmSync, readFileSync, writeFileSync, copyFileSync} from 'node:fs';
import path from 'node:path';
const [view, work] = process.argv.slice(2);
const g = n => path.join(work, 'geometry', n), original = n => path.join(view, 'geometry', n);
const expect = (ok, what) => { console.log((ok ? 'ok    ' : 'WRONG ') + what); if (!ok) process.exitCode = 1; };
const cases = [
  {name: 'mechanism', file: 'mechanism.js', error: /mechanism\.js is missing or could not be read/, breakFile: file => rmSync(file)},
  {name: 'electronics', file: 'electronics.js', error: /electronics\.js is damaged/, breakFile: file => writeFileSync(file, readFileSync(file).subarray(0, 4_000_000))},
  {name: 'cassette', file: 'cassette/cassette.js', error: /cassette failed its integrity check/, optional: true, breakFile: file => {
    const text = readFileSync(file, 'utf8'), at = text.lastIndexOf('\");') - 2000;
    writeFileSync(file, text.slice(0, at) + (text[at] === 'A' ? 'B' : 'A') + text.slice(at + 1));
  }},
];
const browser = await openBrowser({port: 9335});
try {
  for (const scenario of cases) {
    rmSync(work, {recursive: true, force: true}); cpSync(view, work, {recursive: true});
    scenario.breakFile(g(scenario.file));
    const page = await browser.page(), E = page.evaluate;
    try {
      await page.goto(pathToFileURL(path.join(work, 'index.html')).href);
      await page.waitFor('window.portableTapePlayer && window.portableTapePlayer.snapshot().ready', 60);
      await page.click('[data-view="service"]');
      await page.waitFor('window.portableTapePlayer.snapshot().packageErrors.length > 0', 60);
      const broken = await E(`(()=>{const s=window.portableTapePlayer.snapshot();return {loaded:s.loaded,errors:s.packageErrors,unavailable:!!s.state.graphicsUnavailable,ready:s.ready,explanation:document.getElementById('loadingText').textContent,reloadShown:!document.getElementById('loading').hidden&&!document.getElementById('loadingRetry').hidden,oldRetryHidden:document.getElementById('retryAssets').hidden}})()`);
      expect(broken.loaded.includes('exterior') && !broken.loaded.includes(scenario.name), scenario.name + ': intact exterior loads; damaged package does not');
      expect(broken.errors.some(error => scenario.error.test(error)), scenario.name + ': the specific file failure is diagnosed');
      if (scenario.optional) {
        expect(!broken.unavailable && broken.ready, 'optional cassette failure preserves the original rendered geometry');
      } else {
        expect(broken.unavailable && !broken.ready, scenario.name + ': required geometry failure enters catalog-only mode');
        expect(scenario.error.test(broken.explanation), scenario.name + ': the visible recovery panel retains the diagnosis');
        expect(broken.reloadShown && broken.oldRetryHidden, scenario.name + ': one manual Reload viewer action is offered');
      }
      copyFileSync(original(scenario.file), g(scenario.file));
      if (scenario.optional) {
        await E(`(()=>{const select=document.getElementById('cassetteVariant');for(const value of ['original','refined']){select.value=value;select.dispatchEvent(new Event('change'));}})()`);
      } else {
        await page.click('#loadingRetry');
        await page.waitFor('window.portableTapePlayer && window.portableTapePlayer.snapshot().ready', 60);
        await page.click('[data-view="service"]');
      }
      await page.waitFor("['exterior','mechanism','electronics','cassette'].every(n=>window.portableTapePlayer.snapshot().loaded.includes(n))", 60);
      const repaired = await E('window.portableTapePlayer.snapshot()');
      expect(repaired.ready && !repaired.state.graphicsUnavailable, scenario.name + ': repair and the offered recovery action restore rendering');
      if (!scenario.optional) expect(repaired.packageErrors.length === 0, scenario.name + ': the reloaded viewer has no package errors');
    } finally { await page.close(); }
  }
} finally { await browser.close(); rmSync(work, {recursive: true, force: true}); }
