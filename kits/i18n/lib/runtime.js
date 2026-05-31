/**
 * Pure i18n runtime - no DOM, no globals, fully unit-testable.
 *
 * createI18n() takes the app's string table + a translations map and returns the
 * lookup API. index.js wires this to the live app (localStorage, navigator, the
 * language picker, and the i18n:changed DOM event); tests drive it with fixtures.
 */

const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur', 'yi']);

/**
 * Choose the first-load language, never picking one the app doesn't ship.
 * A stored choice wins; then a detected browser language, but only if it's
 * actually translated; otherwise the predictable default ('en'). This keeps a
 * guest on, e.g., an Arabic-locale browser from being dropped into 'ar' (and an
 * RTL flip) on an English-only app — the picker still lets them switch.
 *
 * @param {object}   opts
 * @param {string[]} opts.supported  languages the app ships (e.g. availableLangs())
 * @param {string}  [opts.stored]    previously persisted choice, if any
 * @param {string}  [opts.navLang]   detected browser language (2-letter), if any
 * @param {string}  [opts.fallback]  default when nothing supported matches
 */
export function pickInitialLang({ supported = ['en'], stored, navLang, fallback = 'en' } = {}) {
  const ok = new Set(supported);
  if (stored && ok.has(stored)) return stored;
  if (navLang && ok.has(navLang)) return navLang;
  return fallback;
}

/**
 * @param {object}  opts
 * @param {Record<string,string>}                  opts.strings       base (English) copy, keyed
 * @param {Record<string,Record<string,string>>}  [opts.translations] per-language overrides
 * @param {string}                                 [opts.lang]         initial active language (default 'en')
 */
export function createI18n({ strings = {}, translations = {}, lang = 'en' } = {}) {
  let current = lang;

  // Active-language value for a key, falling back to the base string.
  function lookup(key) {
    if (current !== 'en' && translations[current] && translations[current][key] != null) {
      return translations[current][key];
    }
    return strings[key];
  }

  function interpolate(str, vars) {
    return String(str).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
  }

  /** Localized string for `key`, optionally interpolating {placeholder} vars. */
  function t(key, vars) {
    let str = lookup(key);
    if (str == null) str = key; // missing key -> show the key, never blank
    return vars ? interpolate(str, vars) : str;
  }

  /**
   * Pluralized lookup. Picks `${key}_${rule}` for the active language's
   * Intl.PluralRules category (one/other/few/many/zero/two), falling back to
   * `${key}_other`, then the bare key. `count` is auto-merged into vars.
   */
  function tn(key, count, vars = {}) {
    const rule = new Intl.PluralRules(current).select(count);
    const has = (k) =>
      strings[k] != null || (translations[current] && translations[current][k] != null);
    const chosen = has(`${key}_${rule}`) ? `${key}_${rule}`
      : has(`${key}_other`) ? `${key}_other`
        : key;
    return t(chosen, { count, ...vars });
  }

  return {
    t,
    tn,
    getLang: () => current,
    setLang: (next) => { current = next; },
    isRtl: (code = current) => RTL_LANGS.has(code),
    /** English plus every language present in translations. */
    availableLangs: () => ['en', ...Object.keys(translations)],
  };
}
