// Run synchronously in the head so an explicit choice applies before the first paint.
(() => {
  let preference;
  try { preference = localStorage.getItem('tpsl2-theme'); } catch {}
  const root = document.documentElement;
  if (preference === 'light' || preference === 'dark') root.setAttribute('data-theme', preference);
  else root.removeAttribute('data-theme'); // CSS resolves System, including unavailable storage.
})();
