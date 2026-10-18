// Appearance preference is independent of the model, transport and Reset controls.
export const THEME_STORAGE_KEY = 'tpsl2-theme';
const preferenceOf = value => value === 'light' || value === 'dark' ? value : 'system';

/** Bind after theme-init.js has applied the stored override. CSS resolves the System choice. */
export function createTheme({root = document.documentElement, select = document.getElementById('theme-select'),
  media = matchMedia('(prefers-color-scheme: dark)'), storage = () => localStorage, onChange = () => {}} = {}) {
  let preference = preferenceOf(root.getAttribute('data-theme'));
  const resolved = () => preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
  let lastResolved;
  function apply() {
    if (preference === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', preference);
    if (select) select.value = preference;
    lastResolved = resolved();
    onChange({preference, resolved: lastResolved});
  }
  function setPreference(value) {
    const next = preferenceOf(value), changed = next !== preference;
    preference = next;
    // A blocked getter, quota failure or file:// storage restriction must not undo this choice.
    try {
      const target = storage();
      if (preference === 'system') target.removeItem(THEME_STORAGE_KEY);
      else target.setItem(THEME_STORAGE_KEY, preference);
    } catch {}
    if (changed) apply();
    else if (select) select.value = preference;
  }
  const selected = () => setPreference(select.value);
  const systemChanged = () => {
    if (preference === 'system' && resolved() !== lastResolved) apply();
  };
  select?.addEventListener('change', selected);
  media.addEventListener('change', systemChanged);
  apply();
  return {
    get preference() { return preference; },
    get resolved() { return resolved(); },
    setPreference,
    dispose() {
      select?.removeEventListener('change', selected);
      media.removeEventListener('change', systemChanged);
    },
  };
}
