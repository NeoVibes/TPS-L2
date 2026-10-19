// Focused upgrade checks share the release runner's browsers, URLs and evidence directory.
import assert from 'node:assert/strict';
import path from 'node:path';
const ready = page => page.waitForFunction(()=>window.portableTapePlayer?.snapshot().ready,null,{timeout:90000});
async function select(page,id) {
 await page.locator('#catalog').evaluate(e=>e.open=true);await page.locator('#search').fill(id);
 await page.locator('#results button').filter({hasText:new RegExp('^'+id+' ·')}).click();
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
  await page.locator('#copyPartDetails').focus();await page.locator('#toggleInspector').click();
  assert(await page.locator('#toggleInspector').evaluate(e=>e===document.activeElement),'A pointer collapse must retain focus even when the browser blurs the body control before click');
  await page.locator('#toggleInspector').click();
  for(const theme of ['light','dark']) {
   await page.locator('#theme-select').selectOption(theme);await page.locator('#copyPartDetails').focus();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(output,`${record.browser}-${record.protocol}-inspector-${theme}.png`),fullPage:true});
  }
  record.interactionUpgrade='passed';
 } finally {await page.close();}
}
export async function preferenceChecks({browser,url,record,output}) {
 const context=await browser.newContext({reducedMotion:'reduce'});
 await context.addInitScript(()=>{const set=Storage.prototype.setItem;window.__preferenceWrites=[];Storage.prototype.setItem=function(k,v){if(k==='tpsl2-viewer-preferences')window.__preferenceWrites.push(v);return set.call(this,k,v);};});
 const page=await context.newPage();
 try {
  record.phase='upgrade-preferences-save';
  await page.goto(url);await ready(page);await page.locator('[data-workmode="inspect"]').click();
  await page.locator('#projection').selectOption('orthographic');
  await page.locator('[data-view="exploded"]').click();await page.locator('#toggleLabels').click();await page.locator('#motionCues').uncheck();
  assert.equal(await page.evaluate(()=>window.__preferenceWrites.length),3);
  record.phase='upgrade-preferences-reload';
  await page.reload();await ready(page);
  const check=async()=>{
   const s=await page.evaluate(()=>window.portableTapePlayer.snapshot().state);
   assert.equal(s.projection,'orthographic');assert.equal(s.labels,false);assert.equal(await page.locator('#motionCues').isChecked(),false);
   assert.equal(await page.evaluate(()=>window.__preferenceWrites.length),0);
  };
  await check();record.phase='upgrade-preferences-reset';await page.locator('#reset').click();await check();
  record.phase='upgrade-preferences-tour';
  await page.locator('[data-workmode="tour"]').click();
  // This fixture tests persistence across tour changes, not elapsed playback.
  // Use the real controls in one task so no active tour frame can run between
  // Start, Pause and seek; native interaction checks remain outside this setup.
  record.phase='upgrade-preferences-tour-setup';
  const tourSetup=await page.evaluate(()=>{
   const control=id=>{
    const element=document.getElementById(id),style=element&&getComputedStyle(element);
    if(!element||element.disabled||element.hidden||!element.getClientRects().length||
      style.visibility==='hidden'||style.visibility==='collapse')throw Error('Tour control unavailable: '+id);
    return element;
   };
   const before=window.portableTapePlayer.snapshot().state;
   if(before.uiMode!=='tour'||before.tour!==-1)throw Error('Tour setup must start in idle Tour mode');
   control('tour').click();
   const started=window.portableTapePlayer.snapshot().state;
   if(started.tour<0||started.paused)throw Error('Start control did not start the tour');
   control('tourPause').click();
   const paused=window.portableTapePlayer.snapshot().state.paused;
   if(!paused)throw Error('Pause control did not pause the tour');
   const seek=control('tourSeek');seek.value='64';seek.dispatchEvent(new Event('input',{bubbles:true}));
   return {started:started.tour,paused,state:window.portableTapePlayer.snapshot().state};
  });
  assert(tourSetup.started>=0);assert.equal(tourSetup.paused,true);
  const tourState=tourSetup.state;
  assert.equal(tourState.view,'exploded');assert.equal(tourState.paused,true);
  record.phase='upgrade-preferences-tour-render';
  // Reload initially prepares only the exterior. Finish the detail load and a
  // real exploded render before this persistence check dispatches another click.
  await page.waitForFunction(()=>{
   const snapshot=window.portableTapePlayer.snapshot();
   const text=document.getElementById('stage').dataset.test,render=text&&JSON.parse(text);
   return snapshot.ready&&['exterior','mechanism','electronics','cassette'].every(name=>snapshot.loaded.includes(name))&&
    render?.view==='exploded'&&render.draws>0&&render.triangles>0;
  });
  await check();
  record.phase='upgrade-preferences-inspect';
  await page.locator('[data-workmode="inspect"]').click();
  await page.waitForFunction(()=>{const state=window.portableTapePlayer.snapshot().state;return state.uiMode==='inspect'&&state.tour===-1;});
  record.phase='upgrade-preferences-context';
  await page.locator('[data-context="motorAssembly"]').click();await check();
  record.phase='upgrade-preferences-clear-context';
  await page.locator('#clearContext').click();await check();
  record.preferenceSuccess='passed';
  record.phase='upgrade-preferences-invalid';
  await page.evaluate(()=>localStorage.setItem('tpsl2-viewer-preferences','{bad'));await page.reload();await ready(page);
  assert.equal((await page.evaluate(()=>window.portableTapePlayer.snapshot().state)).projection,'perspective');
  record.phase='upgrade-preferences-denied';
  await context.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw Error('storage denied');}});});
  await page.goto(url+'#part=BLT-001');await ready(page);await page.locator('[data-workmode="inspect"]').click();await page.locator('#projection').selectOption('orthographic');
  assert.equal(await page.locator('#partId').textContent(),'BLT-001');assert.equal((await page.evaluate(()=>window.portableTapePlayer.snapshot().state)).projection,'orthographic');
  record.preferenceInvalidDenied='passed';
 } catch(error) {
  // The outer runner has no reference to this helper's page. Preserve bounded
  // failure evidence before closing it, without replacing the original error.
  let timer;
  try {
   record.preferenceFailure=await Promise.race([
    page.evaluate(()=>{
     const snapshot=window.portableTapePlayer?.snapshot();
     const pause=document.getElementById('tourPause'),rect=pause?.getBoundingClientRect(),aside=document.querySelector('aside');
     const hit=rect&&document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
     return {ready:snapshot?.ready,state:snapshot?.state,loaded:snapshot?.loaded,packageErrors:snapshot?.packageErrors,
      renderedFrames:snapshot?.renderedFrames,render:document.getElementById('stage')?.dataset.test||null,
      preferenceWrites:window.__preferenceWrites?.length,hash:location.hash,
      focusedControl:document.activeElement?.id||document.activeElement?.dataset?.workmode||null,
      tourPause:{text:pause?.textContent,rect:rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null,
       centerHit:hit?{tag:hit.tagName,id:hit.id||null}:null},
      tourClock:document.getElementById('tourClock')?.textContent,
      sidebar:aside?{scrollTop:aside.scrollTop,clientHeight:aside.clientHeight,scrollHeight:aside.scrollHeight}:null};
    }).catch(captureError=>({captureError:String(captureError)})),
    new Promise(resolve=>{timer=setTimeout(()=>resolve({timedOut:true}),5000);})
   ]);
  } finally {clearTimeout(timer);}
  if(output)await page.screenshot({path:path.join(output,`${record.browser}-${record.protocol}-preferences-failure.png`),timeout:5000}).catch(()=>{});
  throw error;
 } finally {await context.close();}
}

export async function catalogChecks({browser,url,record}) {
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 try {
  await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copied=text;if(window.__denyCopy)throw Error('Denied');}}});});
  await page.goto(url);await ready(page);
  await page.locator('#catalog').evaluate(e=>e.open=true);await page.locator('#search').fill('  pinch   ROLLER  ');
  assert.equal(await page.locator('#searchCount').getAttribute('aria-atomic'),'true');
  assert.equal(await page.locator('#results').getAttribute('aria-live'),null);
  await page.locator('#clearSearch').click();assert.equal(await page.locator('#results button').count(),60);
  const first=await page.locator('#results button').first().elementHandle();await page.locator('#moreComponents').click();
  assert.equal(await page.locator('#results button').count(),120);assert(await first.evaluate(e=>e===document.querySelector('#results button')));
  while(await page.locator('#moreComponents').getAttribute('aria-disabled')==='false')await page.locator('#moreComponents').click();
  const count=Number((await page.locator('#searchCount').innerText()).match(/of (\d+)/)[1]);assert.equal(await page.locator('#results button').count(),count);
  assert(await page.locator('#moreComponents').evaluate(e=>e===document.activeElement));
  await page.locator('#search').fill('8-835-008-11');assert.equal(await page.locator('#results button').count(),31);
  await page.locator('#search').fill('nonexistent-id');assert(await page.locator('#searchEmpty').isVisible());
  await select(page,'BLT-001');assert.equal(await page.locator('#partMeasure').innerText(),'X 66.7 × Y 19.3 × Z 4.5 mm');
  await page.locator('#copyPartDetails').click();assert.match(await page.evaluate(()=>window.__copied),/66.714.*19.338.*4.509/);
  await page.evaluate(()=>window.__denyCopy=true);await page.locator('#copyPartDetails').click();assert.match(await page.locator('#copyFallback').inputValue(),/stopped model, lid closed, cassette seated/);
  await page.locator('#masterList').evaluate(e=>e.open=true);await page.locator('#masterSearch').fill('MEDIA-001');
  for(const variant of ['original','detailed']) {
   await page.locator('#masterResults button').filter({hasText:variant+' cassette'}).click();assert.equal(await page.locator('#copyFallback').inputValue(),'');
   assert.equal(await page.locator('#partConfirmation h3').count(),1);await page.locator('#copyPartDetails').click();assert.match(await page.locator('#copyFallback').inputValue(),new RegExp('Cassette: '+variant));
  }
  await page.locator('#masterSearch').fill('EXT-030');await page.locator('#masterResults button').filter({hasText:'intermediate and early'}).click();assert.match(await page.locator('#partConfirmation').innerText(),/Intermediate and early exterior/);
  await page.locator('#masterClear').click();assert.equal(await page.locator('#masterResults button').count(),60);
  await page.locator('#masterStatus').selectOption('not modelled');await page.locator('#masterLevel').selectOption('0');
  await page.locator('#masterMore').click();assert.equal(await page.locator('#masterStatus').inputValue(),'not modelled');
  while(await page.locator('#masterMore').getAttribute('aria-disabled')==='false')await page.locator('#masterMore').click();
  await page.locator('#masterSearch').fill('xyz-none');assert(await page.locator('#masterEmpty').isVisible());await page.locator('#masterClear').click();assert.equal(await page.locator('#masterStatus').inputValue(),'');
  for(const id of ['MTR-001','MEC-011','BAY-052','BAY-061','BAY-060']) {await select(page,id);assert(await page.locator('#partExplanation').isVisible());}
  assert.equal(await page.locator('.photo-request').count(),4);
  record.catalogDetails='passed';
 }finally{await page.close();}
}
export async function failureChecks({browser,url,record,output}) {
 record.failures=[];
 for(const failure of ['webgl','geometry','metadata','context']) {
  record.phase='upgrade-failure-'+failure;
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  try {
   await page.addInitScript(failure=>{
    if(failure==='webgl')HTMLCanvasElement.prototype.getContext=()=>null;
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('Denied');}}});
   },failure);
   if(failure==='geometry')await page.route('**/geometry/exterior.js',route=>route.abort('failed'));
   if(failure==='metadata')await page.route('**/geometry/model.js',route=>route.abort('failed'));
   await page.goto(url+'#part=BLT-001&exterior=early');
   let frames;
   if(failure==='context') {
    await ready(page);
    // Dismissal only replaces the URL fragment; verify it directly instead of waiting for a document navigation.
    await page.locator('#closeInspector').click({noWaitAfter:true});
    await page.locator('#inspector').waitFor({state:'hidden'});
    assert.equal(new URL(page.url()).hash,'#exterior=early');
    assert.equal(await page.evaluate(()=>window.portableTapePlayer.snapshot().state.selectedId),null);
    await page.locator('[data-workmode="operate"]').click();
    await page.locator('#audioEnable').click();await page.locator('[data-mode="play"]').click();
    assert.equal(await page.evaluate(()=>window.portableTapePlayer.snapshot().state.audioEnabled),true);
    assert.equal(await page.evaluate(()=>window.portableTapePlayer.snapshot().state.mode),'play');
    await page.evaluate(()=>{const g=document.getElementById('canvas').getContext('webgl2');const e=g.getExtension('WEBGL_lose_context');if(!e)throw Error('Context loss extension unavailable');e.loseContext();});
   }
   await page.waitForFunction(()=>document.getElementById('loadingTitle').textContent==='3D unavailable; parts catalog available.',null,{timeout:90000});
   assert.equal(await page.locator('#shell').getAttribute('aria-busy'),'false');assert(await page.locator('#loadingRetry').isVisible());assert(await page.locator('#retryAssets').isHidden());
   for(const id of ['tour','projection','section','homeCamera','spread','focus','isolate','audioEnable'])assert(await page.locator('#'+id).isDisabled(),failure+': '+id);
   await page.locator('#masterList').evaluate(e=>e.open=true);await page.locator('#masterSearch').fill('capstan');assert(await page.locator('#masterResults button').count()>0);
   if(failure!=='metadata') {
    await select(page,'BLT-001');await page.locator('#copyPartDetails').click();assert.match(await page.locator('#copyFallback').inputValue(),/66.714/);
    await page.locator('#catalog').evaluate(e=>e.open=true);await page.locator('#clearSearch').click();await page.locator('#moreComponents').click();assert.equal(await page.locator('#results button').count(),120);
    await page.locator('#exteriorVersion').selectOption('intermediate');assert(await page.locator('#focus').isDisabled());
   }else{assert(await page.locator('#search').isDisabled());assert.match(await page.locator('#storyText').innerText(),/metadata did not load/);}
   await page.evaluate(()=>{window.__csv=null;const make=URL.createObjectURL;URL.createObjectURL=b=>{b.text().then(t=>window.__csv=t);return make(b);};document.getElementById('masterDownload').click();});await page.waitForFunction(()=>window.__csv?.includes('row_id'));
   await page.screenshot({path:path.join(output,`${record.browser}-${record.protocol}-${failure}-catalog.png`)});
   if(failure==='context') {
    frames=await page.evaluate(()=>window.portableTapePlayer.snapshot().renderedFrames);await page.waitForTimeout(250);
    const after=await page.evaluate(()=>window.portableTapePlayer.snapshot({appearance:true}));assert.equal(after.renderedFrames,frames);assert.equal(after.state.audioEnabled,false);assert.equal(after.state.mode,'stop');
    await page.locator('#loadingRetry').click();await ready(page);assert(await page.locator('#loading').isHidden());
   }
   record.failures.push({case:failure,passed:true});
  }finally{await page.close();}
 }
}

// Hold real package requests across user actions, so a completed load cannot undo
// a newer selection or the catalog-only recovery state.
export async function loadingRaceChecks({browser,url,record}) {
 record.loadingRaces=[];
 const waitForRoute=async held=>{
  let timer;
  try{return await Promise.race([held,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Expected delayed geometry request did not start')),30000);})]);}
  finally{clearTimeout(timer);}
 };
 const pageErrors=[];
 const newPage=async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',error=>pageErrors.push(String(error)));
  await page.addInitScript(()=>{
   const read=Response.prototype.arrayBuffer;
   window.__geometryReadsCompleted=0;
   Response.prototype.arrayBuffer=async function(...args){
    const result=await read.apply(this,args);window.__geometryReadsCompleted++;return result;
   };
  });
  return page;
 };
 const unavailable=async page=>{
  assert(await page.locator('#loading').isVisible());
  assert(await page.locator('#loadingRetry').isVisible());
  assert(await page.locator('#retryAssets').isHidden());
  assert.equal(await page.locator('#shell').getAttribute('aria-busy'),'false');
  for(const id of ['tour','projection','focus','audioEnable'])assert(await page.locator('#'+id).isDisabled());
  assert.equal(await page.evaluate(()=>Boolean(window.portableTapePlayer?.snapshot().ready)),false);
 };
 let page=await newPage();
 try {
  record.phase='loading-race-startup-context-loss';
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  await page.route('**/geometry/exterior.js',route=>release(route));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  const route=await waitForRoute(held);
  await page.evaluate(()=>{
   const extension=document.getElementById('canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
   if(!extension)throw Error('Context loss extension unavailable');
   extension.loseContext();
  });
  await page.waitForFunction(()=>document.getElementById('loading').dataset.unavailable==='true');
  await unavailable(page);
  await route.continue();
  await page.waitForFunction(()=>window.__geometryReadsCompleted>0);
  await unavailable(page);
  await select(page,'MTR-001');assert(await page.locator('#inspector').isVisible());
  await page.unroute('**/geometry/exterior.js');
  await page.locator('#loadingRetry').click();await ready(page);
  assert(await page.locator('#loading').isHidden());
  record.loadingRaces.push({case:'context-lost-during-startup',passed:true});
 }finally{await page.close();}
 for(const name of ['mechanism','electronics']) {
  page=await newPage();
  try {
   record.phase='loading-race-'+name+'-failure';
   let release;
   const held=new Promise(resolve=>{release=resolve;});
   await page.route('**/geometry/cassette/cassette.js',route=>release(route));
   await page.route('**/geometry/'+name+'.js',route=>route.abort('failed'));
   await page.goto(url,{waitUntil:'domcontentloaded'});await ready(page);const route=await waitForRoute(held);
   await page.locator('[data-view="exploded"]').click();
   await page.waitForFunction(()=>window.portableTapePlayer.snapshot().state.graphicsUnavailable);
   await unavailable(page);
   const before=await page.evaluate(()=>({frames:window.portableTapePlayer.snapshot().renderedFrames,reads:window.__geometryReadsCompleted}));
   await route.continue();await page.waitForFunction(reads=>window.__geometryReadsCompleted>reads,before.reads);
   await unavailable(page);
   assert.match(await page.locator('#loadingText').innerText(),new RegExp('geometry/'+name+'\\.js'));
   assert.equal(await page.evaluate(()=>window.portableTapePlayer.snapshot().renderedFrames),before.frames);
   await select(page,'MTR-001');assert(await page.locator('#inspector').isVisible());
   await page.unroute('**/geometry/'+name+'.js');await page.unroute('**/geometry/cassette/cassette.js');
   await page.locator('#loadingRetry').click();await ready(page);
   assert.equal(await page.evaluate(()=>window.portableTapePlayer.snapshot().state.selectedId),'MTR-001');
   assert.equal(new URL(page.url()).hash,'#part=MTR-001');
   // This view change clears the part fragment without loading a new document.
   await page.locator('[data-view="exploded"]').click({noWaitAfter:true});
   await page.waitForFunction(()=>{
    const snapshot=window.portableTapePlayer.snapshot();
    return snapshot.ready&&snapshot.state.view==='exploded'&&snapshot.state.selectedId===null&&location.hash==='';
   });
   await page.locator('#inspector').waitFor({state:'hidden'});
   await page.waitForFunction(()=>['exterior','mechanism','electronics','cassette'].every(name=>window.portableTapePlayer.snapshot().loaded.includes(name)));
   assert.deepEqual(await page.evaluate(()=>window.portableTapePlayer.snapshot().packageErrors),[]);
   record.loadingRaces.push({case:name+'-failure-after-startup',passed:true});
  }finally{await page.close();}
 }
 page=await newPage();
 try {
  record.phase='loading-race-selection';
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  await page.route('**/geometry/mechanism.js',route=>release(route));
  await page.goto(url);await ready(page);
  await page.locator('[data-workmode="inspect"]').click();await page.locator('[data-context="motorAssembly"]').click();
  const route=await waitForRoute(held);await select(page,'MTR-001');
  const hash=await page.evaluate(()=>location.hash);
  await route.continue();
  await page.waitForFunction(()=>['mechanism','electronics'].every(name=>window.portableTapePlayer.snapshot().loaded.includes(name)));
  assert.equal(await page.evaluate(()=>window.portableTapePlayer.snapshot().state.selectedId),'MTR-001');
  assert(await page.locator('#inspector').isVisible());assert.equal(await page.evaluate(()=>location.hash),hash);
  // The guard must still allow a later, deliberate assembly selection to finish.
  await page.locator('[data-context="motorAssembly"]').click();
  await page.waitForFunction(()=>location.hash.startsWith('#context=motorAssembly'));
  assert(await page.locator('#inspector').isHidden());
  record.loadingRaces.push({case:'selection-during-context-loading',passed:true});
 }finally{await page.close();}
 assert.deepEqual(pageErrors,[],'Delayed and failed loads must not cause uncaught errors');
}
