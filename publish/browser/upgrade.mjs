// Focused upgrade checks share the release runner's browsers, URLs and evidence directory.
import assert from 'node:assert/strict';
import path from 'node:path';
const ready = page => page.waitForFunction(()=>window.portableTapePlayer?.snapshot().ready,null,{timeout:90000});
async function select(page,id) {
 await page.locator('#catalog').evaluate(e=>e.open=true);await page.locator('#search').fill(id);
 await page.locator('#results button').first().click();
}
export async function interactionChecks({browser,url,record,output}) {
 const page=await browser.newPage({viewport:{width:390,height:1000},reducedMotion:'reduce'});
 try {
  await page.goto(url);await ready(page);await select(page,'BLT-001');
  await page.locator('#copyPartDetails').focus();await page.keyboard.press('Escape');
  assert(await page.locator('#inspector').isHidden());assert(await page.locator('#catalog summary').evaluate(e=>e===document.activeElement), JSON.stringify(await page.evaluate(()=>({active:document.activeElement.tagName+"#"+document.activeElement.id,summary:document.querySelector('#catalog summary').outerHTML}))));
  await select(page,'BLT-001');await page.locator('#exteriorVersion').focus();await page.keyboard.press('Space');await page.keyboard.press('Escape');assert(await page.locator('#inspector').isVisible());
  await page.locator('#copyPartDetails').focus();await page.locator('#toggleInspector').evaluate(e=>e.click());
  assert(await page.locator('#inspectorBody').isHidden());assert(await page.locator('#toggleInspector').evaluate(e=>e===document.activeElement));
  await select(page,'BAY-052');assert(await page.locator('#inspectorBody').isHidden());assert.equal(await page.locator('#toggleInspector').getAttribute('aria-expanded'),'false');
  await page.locator('#closeInspector').click();await select(page,'BLT-001');assert(await page.locator('#inspectorBody').isHidden());
  await page.locator('#toggleInspector').click();assert(await page.locator('#inspectorBody').isVisible());
  for(const theme of ['light','dark']) {
   await page.locator('#theme-select').selectOption(theme);await page.locator('#copyPartDetails').focus();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(output,`${record.browser}-${record.protocol}-inspector-${theme}.png`),fullPage:true});
  }
  record.interactionUpgrade='passed';
 } finally {await page.close();}
}
export async function preferenceChecks({browser,url,record}) {
 const context=await browser.newContext({reducedMotion:'reduce'});
 await context.addInitScript(()=>{const set=Storage.prototype.setItem;window.__preferenceWrites=[];Storage.prototype.setItem=function(k,v){if(k==='tpsl2-viewer-preferences')window.__preferenceWrites.push(v);return set.call(this,k,v);};});
 const page=await context.newPage();
 try {
  await page.goto(url);await ready(page);await page.locator('[data-workmode="inspect"]').click();
  await page.locator('#projection').selectOption('orthographic');
  await page.locator('[data-view="exploded"]').click();await page.locator('#toggleLabels').click();await page.locator('#motionCues').uncheck();
  assert.equal(await page.evaluate(()=>window.__preferenceWrites.length),3);
  await page.reload();await ready(page);
  const check=async()=>{
   const s=await page.evaluate(()=>window.portableTapePlayer.snapshot().state);
   assert.equal(s.projection,'orthographic');assert.equal(s.labels,false);assert.equal(await page.locator('#motionCues').isChecked(),false);
   assert.equal(await page.evaluate(()=>window.__preferenceWrites.length),0);
  };
  await check();await page.locator('#reset').click();await check();
  await page.locator('[data-workmode="tour"]').click();await page.locator('#tour').click();await page.locator('#tourSeek').evaluate(e=>{e.value='60';e.dispatchEvent(new Event('input',{bubbles:true}));});await check();
  await page.locator('[data-workmode="inspect"]').click();await page.locator('[data-context="motorAssembly"]').click();await check();
  await page.locator('#clearContext').click();await check();
  record.preferenceSuccess='passed';
  await page.evaluate(()=>localStorage.setItem('tpsl2-viewer-preferences','{bad'));await page.reload();await ready(page);
  assert.equal((await page.evaluate(()=>window.portableTapePlayer.snapshot().state)).projection,'perspective');
  await context.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw Error('storage denied');}});});
  await page.goto(url+'#part=BLT-001');await ready(page);await page.locator('[data-workmode="inspect"]').click();await page.locator('#projection').selectOption('orthographic');
  assert.equal(await page.locator('#partId').textContent(),'BLT-001');assert.equal((await page.evaluate(()=>window.portableTapePlayer.snapshot().state)).projection,'orthographic');
  record.preferenceInvalidDenied='passed';
 } finally {await context.close();}
}
