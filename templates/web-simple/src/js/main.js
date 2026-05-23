// App entry point - wire up DOM and behavior here.
import { config } from './config.js';
import { settings } from './settings.js';
import { t, getLang } from './strings.js';

/** Re-pull all translated text into the DOM. Called once on load, and again
 *  after the user switches language (only fires when config.features.i18n). */
function render() {
  document.documentElement.lang = getLang();
  // Agent: put all `t('key')` → DOM assignments here so language switching works.
  //
  // Examples - delete once you add your own code:
  //
  //   document.getElementById('heading').textContent = t('welcome');
  //   document.getElementById('greet').textContent = t('greeting', { name: 'Sam' });
  //   // Plurals: import { tn } from './strings.js'; strings has items_one/items_other
  //   document.getElementById('count').textContent = tn('items', cart.length);
}

document.addEventListener('DOMContentLoaded', async () => {
  if (config.features?.i18n) {
    const { mountLangPicker } = await import('./i18n.js');
    mountLangPicker();
    document.addEventListener('i18n:changed', render);
  }
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
