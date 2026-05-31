// The i18n seam - the default, monolingual reader behind `@gipity/i18n`.
//
// main.js imports { t, getLang } from '@gipity/i18n'; the importmap in
// index.html points that at this file. t() returns your strings.js copy with
// {placeholder} interpolation - no language switching, no extra weight.
//
// Run `gipity add i18n` to make the app multi-language: it overrides the
// `@gipity/i18n` import with the kit (translations, a language picker,
// persistence, RTL) and every t('key') call site upgrades in place - no edits
// to main.js. You don't edit this file; you add the kit.

import { strings } from './strings.js';

/** Localized string for `key`, interpolating {placeholder} vars when given.
 *  Missing key returns the key itself (never blank). */
export function t(key, vars) {
  let str = strings[key];
  if (str == null) str = key;
  if (vars) return String(str).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
  return str;
}

/** Pluralized lookup. Picks `${key}_${rule}` for the count (one/other/...),
 *  falling back to `${key}_other`, then the bare key. `count` is merged in. */
export function tn(key, count, vars = {}) {
  const rule = new Intl.PluralRules('en').select(count);
  const has = (k) => strings[k] != null;
  const chosen = has(`${key}_${rule}`) ? `${key}_${rule}` : has(`${key}_other`) ? `${key}_other` : key;
  return t(chosen, { count, ...vars });
}

export const getLang = () => 'en';
export const isRtl = () => false;
export const availableLangs = () => ['en'];
export const setLang = () => {}; // no-op until `gipity add i18n` is installed
