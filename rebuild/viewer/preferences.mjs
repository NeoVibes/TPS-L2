// Only explicit user changes save these two presentation choices. The projection is not kept: the viewer always
// opens in perspective, since a remembered orthographic view looked like a fault (a box seen askew, edges never converging).
export const VIEWER_PREFERENCES_KEY = 'tpsl2-viewer-preferences';
export function readPreferences(storage = () => localStorage) {
 const result = {labels:true,motionCues:true};
 try {
  const saved = JSON.parse(storage().getItem(VIEWER_PREFERENCES_KEY));
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
   for (const key of ['labels','motionCues']) if (typeof saved[key] === 'boolean') result[key] = saved[key];
  }
 } catch {}
 return result;
}
export function savePreferences(value, storage = () => localStorage) {
 try { storage().setItem(VIEWER_PREFERENCES_KEY, JSON.stringify({labels:value.labels,motionCues:value.motionCues})); } catch {}
}
