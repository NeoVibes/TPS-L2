// node publish/walkthrough/picture.mjs
//
// Remakes publish/github/three-versions.png, the picture at the top of the README: the model in its
// three exterior versions, oldest first, drawn by the viewer itself in headless Chrome.
import {openBrowser} from './chrome.mjs';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {writeFileSync, readFileSync} from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url)), kit = path.resolve(here, '../..');
const release = JSON.parse(readFileSync(path.join(kit, 'rebuild/config/release.json'), 'utf8'));
const browser = await openBrowser({port: 9339, width: 1500, height: 1300});
try {
  const page = await browser.page(), E = page.evaluate;
  await page.goto(pathToFileURL(path.join(kit, 'view/index.html')).href);
  await page.waitFor('window.portableTapePlayer && window.portableTapePlayer.snapshot().ready', 90);
  // Published artwork uses the original light backdrop regardless of the host preference.
  await E(`(()=>{const e=document.getElementById('theme-select');e.value='light';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await browser.sleep(1500);
  const box = await E(`(()=>{const r=document.getElementById('canvas').getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height}})()`);
  // The middle of the 3D view, where the model stands, clear of the buttons in its corners.
  const clip = {x: box.x + box.w * 0.355, y: box.y + box.h * 0.09, width: box.w * 0.29, height: box.h * 0.80, scale: 1};
  const shots = [];
  for (const version of [...release.exteriors].reverse()) {
    await E(`(()=>{const e=document.getElementById('exteriorVersion');e.value=${JSON.stringify(version.id)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await browser.sleep(900);
    shots.push({...version, png: (await page.send('Page.captureScreenshot', {format: 'png', clip})).data});
  }
  // Lay the three out side by side with their names; the browser does the drawing.
  const sheet = await browser.page();
  await sheet.goto('about:blank');
  const html = '<div id="sheet" style="display:inline-flex;gap:0;background:#e9e7df;font:15px/1.3 system-ui,sans-serif;color:#22303a">' +
    shots.map(s => '<figure style="margin:0;text-align:center"><img style="display:block" src="data:image/png;base64,' + s.png + '"><figcaption style="padding:0 0 14px"><b>' + s.label + '</b> · ' + s.lettering + '<br><span style="font-size:12px;color:#5c6b75">' + s.serials + '</span></figcaption></figure>').join('') + '</div>';
  await sheet.evaluate('document.body.style.margin="0";document.body.innerHTML=' + JSON.stringify(html) + ';Promise.all([...document.images].map(i=>i.decode()))');
  const size = await sheet.evaluate(`(()=>{const r=document.getElementById('sheet').getBoundingClientRect();return {width:Math.floor(r.width),height:Math.floor(r.height)}})()`);
  const out = path.join(kit, 'publish/github/three-versions.png');
  writeFileSync(out, Buffer.from((await sheet.send('Page.captureScreenshot', {format: 'png', clip: {x: 0, y: 0, ...size, scale: 1}})).data, 'base64'));
  console.log('Wrote publish/github/three-versions.png (' + size.width + ' × ' + size.height + ')');
} finally { await browser.close(); }
