// User-facing text - all display copy lives here, read via t('key') in main.js.
// Import the reader from the i18n seam: import { t, tn } from '@gipity/i18n';
//
// Keeping copy in one place (instead of hard-coding it in main.js) means a
// single `gipity add i18n` can make the whole app multi-language later - the
// language picker, persistence, RTL, and translations all hang off these keys.
// Until then, t() just returns the string below with {placeholder} interpolation.
//
// Interpolation - reference variables with {name}-style placeholders:
//   greeting: 'Hello, {name}!'        →  t('greeting', { name: 'Sam' })
//
// Pluralization - define key_one / key_other (and _zero/_two/_few/_many as a
// language needs). Call tn('key', count, extraVars):
//   items_one:   '{count} item'
//   items_other: '{count} items'      →  tn('items', 3)   // "3 items"

export const strings = {
  welcome: '{{JS_TITLE}}',
  loading: 'Loading...',
  // Agent: add your app's copy here, then read it with t('key') in main.js.
  //
  // Example - delete once you add your own:
  //   submitLabel: 'Go',
  //   errorNetwork: 'Network error - please try again.',
};
