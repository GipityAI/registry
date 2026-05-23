// App configuration - identity, constants, and feature flags
// Import: import { config } from './config.js';

export const config = {
  title: '{{JS_TITLE}}',
  version: 1,
  features: {
    // i18n: enable the language picker + translations.js lookup.
    // When false (default), t() returns strings[key] directly - no picker,
    // no localStorage, translations.js ignored. Flip to true when the app
    // needs multiple languages.
    i18n: false,
  },
};
