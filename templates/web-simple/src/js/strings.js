// User-facing text - all display strings live here
// Import: import { t, tn } from './strings.js';
//
// To translate: ask the agent "translate strings to Spanish"
// Translations go in translations.js - this file stays clean.
//
// Multi-language support is off by default. Flip config.features.i18n to true
// to enable the language picker, localStorage persistence, and translations.js
// lookup. With i18n off, t() just returns whatever is in `strings` below.

import { config } from './config.js';
import { translations } from './translations.js';

const I18N_ENABLED = !!config.features?.i18n;
const STORAGE_KEY = `${config.title || 'app'}.lang`;

// Right-to-left scripts (ISO 639-1). applyDir() keeps <html dir> in sync so
// layout flips automatically for Arabic, Hebrew, Persian, Urdu, Yiddish.
const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur', 'yi']);

let lang = 'en';
if (I18N_ENABLED) {
  const browserLang = navigator.language?.slice(0, 2) || 'en';
  lang = localStorage.getItem(STORAGE_KEY) || browserLang;
}

export const strings = {
  welcome: '{{JS_TITLE}}',
  loading: 'Loading...',
  // Agent: add app-specific strings here. Read them with t('key') in main.js.
  //
  // Interpolation - reference variables with {name}-style placeholders:
  //   greeting: 'Hello, {name}!'     →  t('greeting', { name: 'Sam' })
  //
  // Pluralization - define key_one / key_other (and _zero/_two/_few/_many
  // as needed per language). Call tn('key', count, extraVars):
  //   items_one:   '{count} item'
  //   items_other: '{count} items'   →  tn('items', 3)  // "3 items"
  //
  // Example - delete once you add your own strings:
  //
  //   submitLabel: 'Go',
  //   errorNetwork: 'Network error - please try again.',
};

/** Get a localized string, optionally interpolating {placeholder} vars.
 *  When i18n is off, returns strings[key] (ignores translations.js). */
export function t(key, vars) {
  let str;
  if (I18N_ENABLED && lang !== 'en' && translations[lang]?.[key]) {
    str = translations[lang][key];
  } else {
    str = strings[key] ?? key;
  }
  if (vars) {
    return str.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
  }
  return str;
}

/** Pluralized lookup. Picks `${key}_${rule}` where rule is one/other/few/many/
 *  zero/two per the active language's Intl.PluralRules, falling back to
 *  `${key}_other`, then to the bare `key`. `count` is auto-merged into vars
 *  so you can use {count} in the string. */
export function tn(key, count, vars = {}) {
  const rule = new Intl.PluralRules(lang).select(count);
  const has = (k) =>
    strings[k] !== undefined
    || (I18N_ENABLED && translations[lang]?.[k] !== undefined);
  const chosen = has(`${key}_${rule}`) ? `${key}_${rule}`
               : has(`${key}_other`)  ? `${key}_other`
               : key;
  return t(chosen, { count, ...vars });
}

/** Is the given language (default: active) a right-to-left script? */
export function isRtl(code = lang) {
  return RTL_LANGS.has(code);
}

/** Sync <html dir> with the active language. Called at init and from setLang. */
function applyDir() {
  document.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
}
if (I18N_ENABLED) applyDir();

/** Get the active language code. Always 'en' when i18n is off. */
export function getLang() {
  return lang;
}

/** Switch the active language and persist the choice. No-op when i18n is off.
 *  Fires an `i18n:changed` event on `document` so app code can re-render. */
export function setLang(next) {
  if (!I18N_ENABLED) return;
  lang = next;
  localStorage.setItem(STORAGE_KEY, next);
  applyDir();
  document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang: next } }));
}

/** List available languages (English + whatever is in translations.js). */
export function availableLangs() {
  return ['en', ...Object.keys(translations)];
}

// ─────────────────────────────────────────────────────────────────────────
// Locale-aware number / date / currency / relative-time formatting is
// intentionally NOT wrapped here. The native Intl.* APIs are one-liners and
// work directly with getLang() - wrapping them would add code without saving
// any. Use them directly:
//
//   new Intl.NumberFormat(getLang(), { style: 'currency', currency: 'USD' }).format(99.5)
//   new Intl.DateTimeFormat(getLang(), { dateStyle: 'medium' }).format(new Date())
//   new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto' }).format(-2, 'day')
// ─────────────────────────────────────────────────────────────────────────
