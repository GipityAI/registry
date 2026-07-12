/**
 * Theme selection for the Monitor dashboard. Three themes (dark / light / blue);
 * the palette lives in css/styles.css ([data-theme="…"] blocks). This module
 * only flips the `data-theme` attribute on <html> and persists the pick.
 *
 * First paint is handled by an inline script in index.html that reads the same
 * localStorage key before the stylesheet loads, so there's no flash. This module
 * powers the header segmented picker and notifies a callback on change (so the
 * charts, which can't read CSS var()s, can re-read the tokens and re-render).
 */

export const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'blue', label: 'Blue' },
];

const STORAGE_KEY = 'gipity-theme';

function isTheme(v) {
  return v === 'dark' || v === 'light' || v === 'blue';
}

export function getTheme() {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    if (isTheme(t)) return t;
  } catch { /* localStorage unavailable */ }
  return 'dark';
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(theme) {
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  applyTheme(theme);
  return theme;
}

/**
 * Wire the header segmented control (#theme-seg). `onChange(theme)` fires after
 * a switch — main.js uses it to re-theme + re-render the Chart.js charts.
 */
export function initThemePicker(onChange) {
  const seg = document.getElementById('theme-seg');
  if (!seg) return;
  const btns = seg.querySelectorAll('.theme-seg-btn');
  const sync = (active) => btns.forEach((b) => {
    const on = b.dataset.themeSet === active;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  btns.forEach((b) => b.addEventListener('click', () => {
    const t = setTheme(b.dataset.themeSet);
    sync(t);
    if (onChange) onChange(t);
  }));
  sync(getTheme());
}
