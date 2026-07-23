// App configuration - identity, constants, tunables, and feature flags.
// One home for values you read from more than one place (list sizes, poll
// intervals, limits) - edit here and it changes everywhere.
// Import: import { config } from './config.js';

export const config = {
  title: '{{JS_TITLE}}',
  version: 1,

  // Function endpoints live at `${apiBase}/<name>`. The host is stamped at
  // install time with the platform instance this app deploys through - it
  // matches the SDK tag's data-api-base, so don't hardcode a host here.
  apiBase: '{{API_BASE}}/api/{{PROJECT_GUID}}/fn',

  features: {},
};
