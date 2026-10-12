// Everything the build writes for the page lives in view/geometry/ as small scripts. Each one
// calls portableTapePlayerLoaded(name, payload). A script loads when the page is opened straight
// from disk as well as from a web server; a fetched file does not, which is why nothing is fetched.
// The page defines portableTapePlayerLoaded before the first data file runs (see page.html).
const store = () => (globalThis.portableTapePlayerData ||= {});
const waiting = () => (globalThis.portableTapePlayerWaiting ||= {});

/** The part list, the table of geometry files and the control ranges, from geometry/model.js. */
export function modelData() {
  const model = store().model;
  if (!model) throw new Error('geometry/model.js did not load. Keep index.html and the geometry folder together.');
  return model;
}

/** The master parts list, the level descriptions and the repository address, embedded in the page by the build. */
export const listData = () => JSON.parse(document.getElementById('masterParts').textContent);

/** Loads one data file by adding a script tag. Resolves with what the file handed over. */
export function loadDataFile(name, file) {
  const take = () => { const payload = store()[name]; delete store()[name]; return payload; };
  if (name in store()) return Promise.resolve(take());
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const finish = (settle, value) => { delete waiting()[name]; script.remove(); settle(value); };
    waiting()[name] = () => finish(resolve, take());
    script.onerror = () => finish(reject, new Error(`geometry/${file} is missing or could not be read`));
    script.onload = () => { if (waiting()[name]) finish(reject, new Error(`geometry/${file} is damaged`)); };
    script.src = 'geometry/' + file;
    document.head.append(script);
  });
}
