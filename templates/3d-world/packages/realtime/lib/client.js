/**
 * @gipity/realtime - Shared client
 *
 * One Colyseus client and one app-token cache, shared by every room a single
 * createRealtime() opens. Room handles (transport.js) borrow it, so a
 * multi-room app - a lobby plus many match rooms - holds exactly one socket
 * factory and one token, not one set per room.
 */

import { getSettings } from './settings.js';

// Pinned Colyseus client build. Must match the major/minor that the Gipity
// realtime server (wss://rt.gipity.ai) is running - upgrading Colyseus means
// bumping both this line and the server release in lockstep.
const COLYSEUS_ESM = 'https://esm.sh/colyseus.js@0.16.22?bundle-deps';

export function createClient() {
  let colyseus = null;
  let appGuid = null;
  let apiBase = 'https://a.gipity.ai';
  let wsUrl = 'wss://rt.gipity.ai';
  let appToken = null;
  let tokenFetchedAt = 0;
  let tokenPromise = null;

  function resolveAppGuid() {
    if (typeof window === 'undefined') return null;
    if (window.__GIPITY_APP_GUID) return window.__GIPITY_APP_GUID;
    // `gipity deploy` stamps the project GUID into this meta tag. No URL-path
    // guessing fallback - a guessed slug just fails the token API; better to
    // resolve nothing and run offline than connect with a wrong identity.
    const meta = document.querySelector('meta[name="gipity-app"]');
    return meta?.content || null;
  }

  /** Apply connection config (apiBase / wsUrl / appGuid) - only set keys. */
  function configure(cfg = {}) {
    if (cfg.apiBase) apiBase = cfg.apiBase;
    if (cfg.wsUrl) wsUrl = cfg.wsUrl;
    if (cfg.appGuid) appGuid = cfg.appGuid;
  }

  /** The app's project GUID, resolved from the page if not configured. */
  function getAppGuid() {
    if (!appGuid) appGuid = resolveAppGuid();
    return appGuid;
  }

  /** The shared Colyseus client, created on first use. */
  async function colyseusClient() {
    if (!colyseus) {
      const { Client } = await import(COLYSEUS_ESM);
      colyseus = new Client(wsUrl);
    }
    return colyseus;
  }

  /**
   * Fetch (or reuse) the app JWT. Cached, and refreshed once it ages past
   * settings.tokenTtlMs - tokens expire (~15min), so a long-lived page must
   * not hold a stale one. `force` re-fetches regardless of age.
   */
  function acquireToken(force = false) {
    const ttl = getSettings().tokenTtlMs;
    if (appToken && !force && Date.now() - tokenFetchedAt < ttl) {
      return Promise.resolve(appToken);
    }
    if (!tokenPromise) {
      tokenPromise = (async () => {
        const guid = getAppGuid();
        if (!guid) throw new Error('no app GUID - cannot fetch token');
        const res = await fetch(`${apiBase}/api/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app: guid }),
        });
        if (!res.ok) throw new Error(`token fetch failed: ${res.status}`);
        const { data: { token } } = await res.json();
        appToken = token;
        tokenFetchedAt = Date.now();
        return token;
      })().finally(() => { tokenPromise = null; });
    }
    return tokenPromise;
  }

  /** List live room instances - the lobby/directory uses this to discover matches. */
  async function listRooms(roomName) {
    let token;
    try { token = await acquireToken(); } catch { return []; }
    try {
      const rtBase = wsUrl.replace('wss://', 'https://').replace('ws://', 'http://');
      const url = `${rtBase}/rooms?token=${token}${roomName ? '&room=' + encodeURIComponent(roomName) : ''}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : (data?.rooms || []);
    } catch (err) {
      console.warn('[realtime] listRooms failed:', err.message);
      return [];
    }
  }

  return {
    configure, getAppGuid, colyseusClient, acquireToken, listRooms,
    getApiBase: () => apiBase, getWsUrl: () => wsUrl,
  };
}
