// App copy table - read these with t('key') from '@gipity/i18n'.
//
// `gipity add i18n` scaffolds this file as src/js/strings.js. Move your
// user-facing strings here as `key: 'text'`, then replace hard-coded copy in
// the page/main.js with t('key'). The kit mounts a language picker and handles
// persistence + RTL automatically.
//
//   t('greeting', { name: 'Sam' })  ->  interpolates {name}:  "Hello, Sam!"
//   tn('items', 3)                  ->  plural-aware (_one / _other):  "3 items"
//
// Translations for other languages go in the kit's translations.js
// (ask: "translate strings to Spanish and Japanese"). English stays here.

export const strings = {
  welcome: 'Welcome',
  greeting: 'Hello, {name}!',
  items_one: '{count} item',
  items_other: '{count} items',
};
