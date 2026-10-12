// Opens a copy of the viewer with one geometry file missing, one cut short and one altered,
// checks that each is reported, then repairs them and checks that retry recovers. Run by run.mjs.
//   node broken-files.mjs <view folder> <scratch folder>
import {openBrowser} from './chrome.mjs';
import {pathToFileURL} from 'node:url';
import {cpSync, rmSync, readFileSync, writeFileSync, copyFileSync} from 'node:fs';
import path from 'node:path';
const [view, work] = process.argv.slice(2);
rmSync(work, {recursive: true, force: true}); cpSync(view, work, {recursive: true});
const g = n => path.join(work, 'geometry', n), original = n => path.join(view, 'geometry', n);
rmSync(g('mechanism.js'));                                                        // missing
writeFileSync(g('electronics.js'), readFileSync(g('electronics.js')).subarray(0, 4_000_000));   // cut short
const cassette = readFileSync(g('cassette/cassette.js'), 'utf8');                 // valid script, altered content
writeFileSync(g('cassette/cassette.js'), cassette.replace(/[A-Za-z]{6}(?=.{2000}"\);)/, 'AAAAAA'));
const browser = await openBrowser({port: 9335});
try {
  const page = await browser.page(), E = page.evaluate;
  await page.goto(pathToFileURL(path.join(work, 'index.html')).href);
  await page.waitFor('window.portableTapePlayer && window.portableTapePlayer.snapshot().ready', 60);
  await E(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Service view')).click()`);
  await browser.sleep(4000);
  const report = () => E(`(()=>{const s=window.portableTapePlayer.snapshot();return {loaded:[...s.loaded].sort(),errors:s.packageErrors,status:document.getElementById('packageStatus').textContent,retryShown:!document.getElementById('retryAssets').hidden}})()`);
  const broken = await report();
  for (const n of ['mechanism.js', 'electronics.js', 'cassette/cassette.js']) copyFileSync(original(n), g(n));
  await page.click('#retryAssets'); await browser.sleep(4000);
  if ((await report()).loaded.length < 3) { await E(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Service view')).click()`); await browser.sleep(3000); }
  const repaired = await report();
  const expect = (ok, what) => { console.log((ok ? 'ok    ' : 'WRONG ') + what); if (!ok) process.exitCode = 1; };
  expect(broken.loaded.join() === 'exterior', 'only the intact file loads');
  expect(broken.errors.some(e => /mechanism\.js is missing or could not be read/.test(e)), 'a missing file is named');
  expect(broken.errors.some(e => /electronics\.js is damaged/.test(e)), 'a cut-short file is reported as damaged');
  expect(broken.errors.some(e => /cassette failed its integrity check/.test(e)), 'an altered file fails its check');
  expect(broken.retryShown, 'a retry control is offered');
  expect(['electronics', 'exterior', 'mechanism'].every(n => repaired.loaded.includes(n)), 'after repair, retry loads the files');
} finally { await browser.close(); rmSync(work, {recursive: true, force: true}); }
