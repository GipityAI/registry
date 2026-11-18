// App configuration. Import: import { config } from './config.js';

export const config = {
  version: 1,

  // The public feed function (functions/status.js). The page calls it with
  // Gipity.fn, which targets whichever environment this page was deployed to.
  feedFunction: 'status',

  // How often the open page refreshes, in ms (checks run once a minute).
  refreshMs: 60_000,
};
