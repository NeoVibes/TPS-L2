// A captured control gesture owns the pointer until release. Orbiting remains
// available everywhere else; releasing outside the canvas never leaves Hot Line on.
export function installControlPointers({canvas,hitTest,describe,enabled,value,projectedAxis,activate,inspect,hint,setOrbitEnabled}) {
 let down=null;
 const suppressed=new Set(),orbitPointers=new Set();
 const stop=event=>{event.preventDefault();event.stopImmediatePropagation();};
 const release=(keepCapture=false)=>{if(!down)return;const old=down;down=null;if(old.control?.hold)activate(old.hit.partId,'release');setOrbitEnabled(true);if(old.control&&!keepCapture&&canvas.hasPointerCapture?.(old.id))canvas.releasePointerCapture(old.id);hint('');};
 const endSuppressed=event=>{if(!suppressed.has(event.pointerId))return false;stop(event);suppressed.delete(event.pointerId);if(canvas.hasPointerCapture?.(event.pointerId))canvas.releasePointerCapture(event.pointerId);return true;};
 canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  if(orbitPointers.size){orbitPointers.add(event.pointerId);down=null;return;}
  if(down){
   if(down.id===event.pointerId)return;
   if(down.control){
    // Orbit never received the first control pointer-down. Keep that pointer
    // captured and consume its later events; let the new pointer start a fresh
    // orbit gesture. Replaying a synthetic first down would invent a pinch.
    suppressed.add(down.id);release(true);
   }else{down=null;hint('');}
   orbitPointers.add(event.pointerId);return;
  }
  suppressed.delete(event.pointerId);
  const hit=hitTest(event),control=hit&&enabled()?describe(hit.partId):null;
  down={id:event.pointerId,x:event.clientX,y:event.clientY,hit,control};
  if(!control){orbitPointers.add(event.pointerId);return;}
  event.preventDefault();event.stopImmediatePropagation();setOrbitEnabled(false);canvas.setPointerCapture(event.pointerId);
  if(control.hold)activate(hit.partId,'press');
  if(control.drag){down.initial=value(hit.partId);down.axis=projectedAxis(hit.partId);}
  hint(control.label+(control.hold?' · release to stop':control.drag?' · drag to adjust':''));
 },true);
 canvas.addEventListener('pointermove',event=>{
  if(suppressed.has(event.pointerId)){stop(event);return;}
  if(!down){const hit=hitTest(event),control=hit&&enabled()?describe(hit.partId):null;canvas.style.cursor=control?(control.drag?'ns-resize':'pointer'):'grab';hint(control?control.label+(control.hold?' · press and hold':control.drag?' · drag to adjust':' · click'):'');return;}
  if(down.id!==event.pointerId||!down.control)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(down.control.drag&&down.axis){const [a,b]=down.axis,dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;if(length2>16){const delta=((event.clientX-down.x)*dx+(event.clientY-down.y)*dy)/length2;activate(down.hit.partId,'drag',Math.max(0,Math.min(1,down.initial+delta)));}}
 },true);
 canvas.addEventListener('pointerup',event=>{
  if(endSuppressed(event))return;
  orbitPointers.delete(event.pointerId);
  if(!down||down.id!==event.pointerId)return;
  const old=down,moved=Math.hypot(event.clientX-old.x,event.clientY-old.y)>5;
  if(old.control){event.preventDefault();event.stopImmediatePropagation();if(!old.control.drag&&!old.control.hold&&!moved)activate(old.hit.partId,'click');else if(old.control.drag&&!moved&&old.control.toggle)activate(old.hit.partId,'click');}
  else if(!moved&&old.hit)inspect(old.hit.partId);
  release();
 },true);
 canvas.addEventListener('pointercancel',event=>{if(endSuppressed(event))return;orbitPointers.delete(event.pointerId);if(down?.id===event.pointerId){if(down.control)stop(event);release();}},true);
 canvas.addEventListener('lostpointercapture',event=>{if(down?.id===event.pointerId)release();},true);
 canvas.addEventListener('pointerleave',()=>{if(!down)hint('');});
 // Orbit captures its first pointer, but a later pinch pointer may end outside
 // the canvas. Observe that document event so it cannot leave a stale gesture.
 for(const name of ['pointerup','pointercancel'])canvas.ownerDocument?.addEventListener(name,event=>{
  orbitPointers.delete(event.pointerId);
  if(event.target!==canvas){if(endSuppressed(event))return;if(down?.id===event.pointerId&&!down.control)release();}
 },true);
 return {cancel:()=>{release();orbitPointers.clear();for(const id of suppressed)if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);suppressed.clear();}};
}

export function bindHoldButton(button,setActive) {
 let held=false;
 const start=()=>{if(!held){held=true;setActive(true);}},end=()=>{if(held){held=false;setActive(false);}};
 button.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();button.setPointerCapture(event.pointerId);start();});
 for(const name of ['pointerup','pointercancel','lostpointercapture','blur'])button.addEventListener(name,end);
 button.addEventListener('keydown',event=>{if(event.code==='Space'||event.code==='Enter'){event.preventDefault();start();}});
 button.addEventListener('keyup',event=>{if(event.code==='Space'||event.code==='Enter'){event.preventDefault();end();}});
 return {cancel:end};
}
