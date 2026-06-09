// App entry point - wire up the page here.
//
// The Gipity client SDK (injected in <head>) exposes Gipity.fn(name, body?) for
// calling the serverless functions in functions/. This template ships one
// example function (functions/example.js) so the frontend → function → database
// path works the moment you deploy. Replace it - and this file - with your app.
import { config } from './config.js';
import { settings } from './settings.js';

document.addEventListener('DOMContentLoaded', async () => {
  const status = document.getElementById('status');

  // Example - confirms the backend is reachable. Delete once you add real UI.
  try {
    const res = await Gipity.fn('example');
    status.textContent = res?.ok
      ? `${config.title} is connected. Edit functions/example.js and this page to build your app.`
      : 'Unexpected response from the example function.';
  } catch (err) {
    status.textContent = 'Could not reach the backend - run `gipity deploy dev` first.';
  }

  // `config` holds identity and flags; `settings` holds tunables - use them as
  // you build (e.g. settings.recentLimit for a list size, config.version in a footer).
});
