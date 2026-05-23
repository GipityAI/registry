// User-facing text - all display strings live here
// Import: import { t } from './strings.js';

import { translations } from './translations.js';

const lang = navigator.language?.slice(0, 2) || 'en';

export const strings = {
  welcome: '{{JS_TITLE}}',
  loading: 'Loading...',
  zipLabel: 'ZIP Code',
  zipPlaceholder: '90210',
  submitLabel: 'Get Weather',
  loadingText: 'Looking up weather...',
  errorInvalidZip: 'Please enter a valid 5-digit US zip code.',
  errorNotFound: 'Could not find weather for that location.',
  errorNetwork: 'Network error - please try again.',
  recentTitle: 'Recent Lookups',
  noRecent: 'No recent lookups yet.',
};

export function t(key) {
  if (lang !== 'en' && translations[lang]?.[key]) {
    return translations[lang][key];
  }
  return strings[key] ?? key;
}
