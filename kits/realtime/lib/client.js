/**
 * @gipity/realtime - Shared client
 *
 * One Colyseus client and one app-token cache, shared by every room a single
 * createRealtime() opens. Room handles (transport.js) borrow it, so a
 * multi-room app - a lobby plus many match rooms - holds exactly one socket
 * factory and one token, not one set per room.
 */

import { getSettings } from './settings.js';
import { RealtimeJoinError } from './errors.js';

// Pinned Colyseus client build. Must match the major/minor that the Gipity
// realtime server (wss://rt.gipity.ai) is running - upgrading Colyseus means
// bumping both this line and the server release in lockstep.
const COLYSEUS_ESM = 'https://esm.sh/colyseus.js@0.16.22?bundle-deps';

// The API base for THIS app's server. The deploy pipeline stamps it onto the injected
// SDK tag (data-api-base) — a page deployed by a local dev server must call THAT
// server, not prod, or every token/API call 404s against an app that doesn't exist
// there. Fall back to prod for pages older than the stamp.
function resolveApiBase() {
  if (typeof document !== 'undefined') {
    const tag = document.querySelector('script[data-api-base]');
    const base = tag?.getAttribute('data-api-base');
    if (base) return base.replace(/\/+$/, '');
  }
  return 'https://a.gipity.ai';
}

// The realtime WebSocket endpoint, stamped the same way (data-ws-url on the SDK
// tag). Rooms are provisioned in the deploying server's DB, so a page deployed
// by a local/dev platform instance must connect to THAT instance's Colyseus -
// against prod the app's rooms don't exist and every join fails auth. Fall back
// to prod for pages older than the stamp.
function resolveWsUrl() {
  if (typeof document !== 'undefined') {
    const tag = document.querySelector('script[data-ws-url]');
    const url = tag?.getAttribute('data-ws-url');
    if (url) return url.replace(/\/+$/, '');
  }
  return 'wss://rt.gipity.ai';
}

export function createClient() {
  let colyseus = null;
  let appGuid = null;
  let apiBase = resolveApiBase();
  let wsUrl = resolveWsUrl();
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

  /**
   * The app's default room: `gipity deploy` stamps the first room its
   * gipity.yaml realtime phase declares onto every page as
   * <meta name="gipity-realtime-room">. A join that names no room uses it,
   * so it lands in a room that is actually provisioned. null when the page
   * has none (no realtime phase, or not deployed by Gipity).
   */
  function getDefaultRoom() {
    if (typeof document === 'undefined') return null;
    return document.querySelector('meta[name="gipity-realtime-room"]')?.content || null;
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

  /**
   * Trade the signed-in user's session for a realtime user ticket (the
   * `userTicket` join option of an auth_level:'user' room). Uses the Gipity
   * session cookie with the app token, or `userToken` as a Bearer token (an app
   * player's sign-in). Fetched per join: tickets are short-lived.
   */
  async function acquireUserTicket(userToken) {
    const guid = getAppGuid();
    if (!guid) throw new RealtimeJoinError('offline', 'no app GUID - cannot sign in to a realtime room');
    const headers = { 'Content-Type': 'application/json' };
    if (userToken) headers.Authorization = `Bearer ${userToken}`;
    else headers['X-App-Token'] = await acquireToken();
    let res;
    try {
      res = await fetch(`${apiBase}/api/${encodeURIComponent(guid)}/realtime/ticket`, {
        method: 'POST', headers, body: '{}', credentials: 'include',
      });
    } catch (err) {
      throw new RealtimeJoinError('offline', `realtime ticket request failed: ${err.message}`, err);
    }
    if (res.status === 401 || res.status === 403) {
      throw new RealtimeJoinError('auth', 'sign in to this app first to join a signed-in realtime room');
    }
    if (!res.ok) throw new RealtimeJoinError('failed', `realtime ticket request failed: ${res.status}`);
    const { data: { ticket } } = await res.json();
    return ticket;
  }

  /** List live room instances - the lobby/directory uses this to discover matches. */
  async function listRooms(roomName, scope) {
    let token;
    try { token = await acquireToken(); } catch { return []; }
    try {
      const rtBase = wsUrl.replace('wss://', 'https://').replace('ws://', 'http://');
      const url = `${rtBase}/rooms?token=${token}`
        + (roomName ? '&room=' + encodeURIComponent(roomName) : '')
        + (scope !== undefined ? '&scope=' + encodeURIComponent(scope) : '');
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
    configure, getAppGuid, getDefaultRoom, colyseusClient, acquireToken, acquireUserTicket, listRooms,
    getApiBase: () => apiBase, getWsUrl: () => wsUrl,
  };
}
