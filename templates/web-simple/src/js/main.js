// App entry point - wire up DOM and behavior here.
import { config } from './config.js';
import { settings } from './settings.js';
import { t, getLang } from '@gipity/i18n';

/** Pull copy into the DOM. Runs on load, and again whenever the language
 *  changes - the `i18n:changed` event only fires once you `gipity add i18n`,
 *  so wiring it now means switching languages "just works" with no rewrite. */
function render() {
  document.documentElement.lang = getLang();
  // Agent: put all `t('key')` → DOM assignments here.
  //
  // Examples - delete once you add your own code:
  //
  //   document.getElementById('heading').textContent = t('welcome');
  //   document.getElementById('greet').textContent = t('greeting', { name: 'Sam' });
  //   // Plurals: import { tn } from '@gipity/i18n'; strings has items_one/items_other
  //   document.getElementById('count').textContent = tn('items', cart.length);
}

document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('i18n:changed', render);
  render();

  // Agent: add event listeners and app logic here.
  // Use t('key') for user-facing text, config for identity/flags, settings for tunables.
  //
  // Example - delete once you add your own code:
  //
  //   const btn = document.getElementById('go');
  //   btn.textContent = t('submitLabel');
  //   btn.addEventListener('click', () => {
  //     if (settings.theme === 'dark') { /* ... */ }
  //     console.log(`${config.title} v${config.version}`);
  //   });
});
