// App configuration - identity, constants, and feature flags
// Import: import { config } from './config.js';

export const config = {
  title: '{{JS_TITLE}}',
  version: 1,

  // API base - calls go to https://a.gipity.ai/api/{{PROJECT_GUID}}/fn/<name>
  apiBase: 'https://a.gipity.ai/api/{{PROJECT_GUID}}/fn',

  features: {},
};
