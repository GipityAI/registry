// Language picker - mounted only when config.features.i18n is true.
// main.js dynamic-imports this file so apps with i18n off don't pay for it.
//
// Add a language: translate strings into translations.js, then add a
// display name to LANG_NAMES below so it shows nicely in the dropdown.

import { getLang, setLang, availableLangs } from './strings.js';

const LANG_NAMES = {
  en: 'English',
  es: 'Español',
  zh: '中文',
  hi: 'हिन्दी',
  ar: 'العربية',
  pt: 'Português',
  fr: 'Français',
  sw: 'Kiswahili',
};

/** Mount the language picker into `parent` (defaults to document.body).
 *  Returns the wrapper element so callers can style or remove it. */
export function mountLangPicker(parent = document.body) {
  const wrapper = document.createElement('div');
  wrapper.className = 'lang-picker';

  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Language');
  for (const code of availableLangs()) {
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
