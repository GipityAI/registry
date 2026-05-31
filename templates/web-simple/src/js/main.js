// App entry point - wire up the page here.
import { config } from './config.js';
import { settings } from './settings.js';

document.addEventListener('DOMContentLoaded', () => {
  // Agent: build the app here - read/write the DOM, add listeners, call services.
  // Put user-facing text right in index.html or here. `config` holds identity
  // and flags; `settings` holds tunables. (Multi-language later? `gipity add i18n`.)
  //
  // Example - delete once you add your own code:
  //   const btn = document.getElementById('go');
  //   btn.addEventListener('click', () => {
  //     if (settings.theme === 'dark') { /* ... */ }
  //     console.log(`${config.title} v${config.version}`);
  //   });
});
