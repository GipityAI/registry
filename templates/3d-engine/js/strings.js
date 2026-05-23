// User-facing text - all display strings live here
// Import: import { t } from './strings.js';
//
// To translate: ask the agent "translate strings to Spanish"
// Translations go in translations.js - this file stays clean.

import { translations } from './translations.js';

const lang = navigator.language?.slice(0, 2) || 'en';

export const strings = {
  loading: 'Loading…',
  connecting: 'Connecting…',
};

/** Get a localized string, falling back to English. */
export function t(key) {
  if (lang !== 'en' && translations[lang]?.[key]) {
    return translations[lang][key];
  }
  return strings[key] ?? key;
}
