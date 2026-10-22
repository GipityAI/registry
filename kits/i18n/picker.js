/**
 * Language picker - a <select> that switches the active language.
 *
 * Mounted automatically by index.js once at least one translation exists, so
 * apps don't have to wire it. It brings its own small default style (pinned top
 * corner, theme tokens). The rules use :where(), so any `.lang-picker` rule in
 * the app's CSS overrides them without a specificity fight.
 */

const STYLE_ID = 'gipity-lang-picker-style';
const DEFAULT_CSS = `
:where(.lang-picker) { position: fixed; top: var(--space-sm, 8px); inset-inline-end: var(--space-sm, 8px); z-index: 10; }
:where(.lang-picker select) {
  margin: 0; padding: 2px var(--space-sm, 8px);
  background: var(--surface, #1a1a1a); color: var(--text-main, #e6e6e6);
  border: 1px solid var(--border, #555); border-radius: var(--radius, 6px);
  font-size: var(--text-xs, 12px); line-height: 1.5; text-align: center; text-align-last: center;
  appearance: none; -webkit-appearance: none; background-image: none; transition: border-color 0.2s;
}
:where(.lang-picker select:hover, .lang-picker select:focus) { border-color: var(--primary, #fea60b); }
`;

function ensureDefaultStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = DEFAULT_CSS;
  document.head.prepend(style);
}

// Display names for the languages the starter ships strings hints for. Any code
// not listed falls back to showing the raw code - add a name here to prettify it.
const LANG_NAMES = {
  en: 'English',
  es: 'Español',
  zh: '中文',
  hi: 'हिन्दी',
  ar: 'العربية',
  pt: 'Português',
  fr: 'Français',
  de: 'Deutsch',
  ja: '日本語',
  sw: 'Kiswahili',
};

/**
 * Mount the picker into `parent` (default: document.body). No-op (returns null)
 * when only one language is available - nothing to switch to yet.
 *
 * @param {{ getLang: () => string, setLang: (c: string) => void, availableLangs: () => string[] }} i18n
 * @param {HTMLElement} [parent]
 * @returns {HTMLElement|null} the wrapper element, or null if not mounted
 */
export function mountLangPicker({ getLang, setLang, availableLangs }, parent = document.body) {
  const langs = availableLangs();
  if (langs.length <= 1) return null;

  ensureDefaultStyle();
  const wrapper = document.createElement('div');
  wrapper.className = 'lang-picker';

  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Language');
  for (const code of langs) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = LANG_NAMES[code] ?? code;
    if (code === getLang()) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', (e) => setLang(e.target.value));

  wrapper.appendChild(select);
  parent.prepend(wrapper);
  return wrapper;
}
