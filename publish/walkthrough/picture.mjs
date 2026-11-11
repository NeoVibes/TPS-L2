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
const config = JSON.parse(readFileSync(path.join(kit, 'rebuild/config/model.json'), 'utf8'));
const browser = await openBrowser({port: 9339, width: 1500, height: 1300});
try {
  const page = await browser.page(), E = page.evaluate;
  await page.goto(pathToFileURL(path.join(kit, 'view/index.html')).href);
  await page.waitFor('window.portableTapePlayer && window.portableTapePlayer.snapshot().ready', 90);
  // Published artwork uses the original light backdrop regardless of the host preference.
  await E(`(()=>{const e=document.getElementById('theme-select');e.value='light';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await browser.sleep(1500);
  // Around the player as drawn: the corners of its parts' bounds, projected with the viewer's own camera.
  const clip = await E(`(()=>{const c=window.portableTapePlayer.snapshot({appearance:true}).appearanceInvariant.camera,[qx,qy,qz,qw]=c.quaternion,m=c.projectionMatrix;
    const r=document.getElementById('canvas').getBoundingClientRect(),assemblies=${JSON.stringify(config.accessories.assemblies)};
    const parts=window.portableTapePlayerData.model.meta.parts.filter(p=>!assemblies.includes(p.assembly)),lo=[1e9,1e9,1e9],hi=[-1e9,-1e9,-1e9];
    for(const p of parts)for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],p.authoritativeBounds.min[i]);hi[i]=Math.max(hi[i],p.authoritativeBounds.max[i]);}
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    for(const X of [lo[0],hi[0]])for(const Y of [lo[1],hi[1]])for(const Z of [lo[2],hi[2]]){
      const v=[X-c.position[0],Y-c.position[1],Z-c.position[2]],x=-qx,y=-qy,z=-qz,w=qw;
      const ix=w*v[0]+y*v[2]-z*v[1],iy=w*v[1]+z*v[0]-x*v[2],iz=w*v[2]+x*v[1]-y*v[0],iw=-x*v[0]-y*v[1]-z*v[2];
      const e=[ix*w+iw*-x+iy*-z-iz*-y,iy*w+iw*-y+iz*-x-ix*-z,iz*w+iw*-z+ix*-y-iy*-x];
      const P=m[0]*e[0]+m[4]*e[1]+m[8]*e[2]+m[12],Q=m[1]*e[0]+m[5]*e[1]+m[9]*e[2]+m[13],W=m[3]*e[0]+m[7]*e[1]+m[11]*e[2]+m[15];
      const sx=r.left+(P/W+1)/2*r.width,sy=r.top+(1-Q/W)/2*r.height;x0=Math.min(x0,sx);x1=Math.max(x1,sx);y0=Math.min(y0,sy);y1=Math.max(y1,sy);}
    const pad=(y1-y0)*.04;return {x:Math.max(r.left,x0-pad),y:Math.max(r.top,y0-pad),width:Math.min(r.right,x1+pad)-Math.max(r.left,x0-pad),height:Math.min(r.bottom,y1+pad)-Math.max(r.top,y0-pad),scale:1}})()`);
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
    shots.map(s => '<figure style="margin:0;text-align:center"><img style="display:block;width:440px" src="data:image/png;base64,' + s.png + '"><figcaption style="padding:0 0 14px"><b>' + s.label + '</b> · ' + s.lettering + '<br><span style="font-size:12px;color:#5c6b75">' + s.serials + '</span></figcaption></figure>').join('') + '</div>';
  await sheet.evaluate('document.body.style.margin="0";document.body.innerHTML=' + JSON.stringify(html) + ';Promise.all([...document.images].map(i=>i.decode()))');
  const size = await sheet.evaluate(`(()=>{const r=document.getElementById('sheet').getBoundingClientRect();return {width:Math.floor(r.width),height:Math.floor(r.height)}})()`);
  const out = path.join(kit, 'publish/github/three-versions.png');
  writeFileSync(out, Buffer.from((await sheet.send('Page.captureScreenshot', {format: 'png', clip: {x: 0, y: 0, ...size, scale: 1}})).data, 'base64'));
  console.log('Wrote publish/github/three-versions.png (' + size.width + ' × ' + size.height + ')');
} finally { await browser.close(); }
