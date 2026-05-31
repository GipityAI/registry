/**
 * @gipity/i18n - multi-language for any Gipity web app.
 *
 * You don't import this directly. `gipity add i18n` rewires the app's
 * `@gipity/i18n` import to this module, so every existing
 * `import { t } from '@gipity/i18n'` call site becomes translation-aware and a
 * language picker mounts itself - no app code changes. Your copy stays in
 * src/js/strings.js (imported here as `@app/strings`); translations live in
 * translations.js next to this file.
 *
 * To translate, ask the agent: "translate strings to Spanish and Japanese".
 */

import { strings } from '@app/strings';
import { translations } from './translations.js';
import { createI18n, pickInitialLang } from './lib/runtime.js';
import { mountLangPicker } from './picker.js';

const STORAGE_KEY = 'app.lang';

// Reads the browser globals, then defers the choice to the pure helper so the
// "only pick a language we actually ship" rule stays unit-testable.
function initialLang() {
  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* no localStorage (SSR, sandboxed) */ }
  const navLang = typeof navigator !== 'undefined' && navigator.language
    ? navigator.language.slice(0, 2) : null;
  return pickInitialLang({ supported: ['en', ...Object.keys(translations)], stored, navLang });
}

const i18n = createI18n({ strings, translations, lang: initialLang() });

export const { t, tn, getLang, isRtl, availableLangs } = i18n;

/**
 * Switch language: persists the choice, syncs <html lang>/<dir>, and fires an
 * `i18n:changed` event on document so app render() hooks re-pull their text.
 */
export function setLang(next) {
  i18n.setLang(next);
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
    document.documentElement.dir = isRtl(next) ? 'rtl' : 'ltr';
    document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang: next } }));
  }
}

// Auto-wire on load: sync direction/lang and mount the picker. Apps get the
// language switcher for free - no call needed in main.js.
if (typeof document !== 'undefined') {
  document.documentElement.lang = getLang();
  document.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
  const boot = () => mountLangPicker({ getLang, setLang, availableLangs });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}

export { mountLangPicker };
