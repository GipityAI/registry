// App entry point - wire up the page here.
//
// The Gipity client SDK (injected in <head>) exposes Gipity.fn(name, body?):
// it POSTs to functions/<name>.js and resolves to whatever that function
// returned, unwrapped - use result.field, never result.data.field.
import { config } from './config.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Build your app here. `config` holds identity and flags
  // (config.title, config.version, config.apiBase).
});
