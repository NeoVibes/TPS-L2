// Only explicit user changes save these three presentation choices.
export const VIEWER_PREFERENCES_KEY = 'tpsl2-viewer-preferences';
export function readPreferences(storage = () => localStorage) {
 const result = {projection:'perspective',labels:true,motionCues:true};
 try {
  const saved = JSON.parse(storage().getItem(VIEWER_PREFERENCES_KEY));
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
   if (['perspective','orthographic'].includes(saved.projection)) result.projection = saved.projection;
   for (const key of ['labels','motionCues']) if (typeof saved[key] === 'boolean') result[key] = saved[key];
  }
 } catch {}
 return result;
}
export function savePreferences(value, storage = () => localStorage) {
 try { storage().setItem(VIEWER_PREFERENCES_KEY, JSON.stringify({projection:value.projection,labels:value.labels,motionCues:value.motionCues})); } catch {}
}
