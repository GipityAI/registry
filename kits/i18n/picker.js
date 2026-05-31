/**
 * Language picker - a <select> that switches the active language.
 *
 * Mounted automatically by index.js once at least one translation exists, so
 * apps don't have to wire it. Style `.lang-picker` in your CSS to taste.
 */

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
