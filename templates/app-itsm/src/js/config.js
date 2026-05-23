// config.js - Application configuration

const config = {
    API_BASE: '',
    APP_GUID: '',
    APP_TOKEN: '',
    initialized: false,
};

/**
 * Initialize config from the runtime environment.
 * Attempts to read from meta tags, then falls back to window.__GIPITSM_CONFIG__,
 * then to sensible defaults for local dev.
 */
export function initConfig() {
    // Check for injected runtime config
    if (window.__GIPITSM_CONFIG__) {
        Object.assign(config, window.__GIPITSM_CONFIG__);
    }

    // Check meta tags
    const apiBase = document.querySelector('meta[name="api-base"]');
    const appGuid = document.querySelector('meta[name="app-guid"]');
    const appToken = document.querySelector('meta[name="app-token"]');

    if (apiBase) config.API_BASE = apiBase.content;
    if (appGuid) config.APP_GUID = appGuid.content;
    if (appToken) config.APP_TOKEN = appToken.content;

    // Fallback: try localStorage (set during dev)
    if (!config.API_BASE) {
        config.API_BASE = localStorage.getItem('gipitsm_api_base') || 'https://a.gipity.ai';
    }
    if (!config.APP_GUID) {
        config.APP_GUID = localStorage.getItem('gipitsm_app_guid') || '';
    }
    if (!config.APP_TOKEN) {
        config.APP_TOKEN = localStorage.getItem('gipitsm_app_token') || '';
    }

    config.initialized = true;
}

export default config;
