/**
 * Sign-in for the Monitor app, on its own origin.
 *
 * Monitor acts as your whole Gipity account, so it works only on its own
 * address (https://monitor--<account>.gipity.app/), never on the shared
 * app.gipity.ai host where every app's pages share one origin. There the
 * Gipity SDK (loaded by index.html) signs in with a one-time hand-off that
 * ends in a host-only session cookie, and every API call goes same-origin to
 * /__gipity/. The platform acts as the account only for the account owner's
 * own Monitor on its own host, with the Account scope granted on that host
 * (platform middleware/owner-app-host.ts).
 */

// Identity (1) + Account (128). Account is only ever granted to your own
// Monitor, on its own host.
const PERMISSIONS = 1 | 128;

// Refresh the app token a minute before it expires.
const TOKEN_REFRESH_BUFFER_MS = 60_000;
let tokenCache = null;
let tokenInflight = null;
let configured = false;

function sdk() {
  const g = window.Gipity;
  if (!g || !g.auth || !g.app) throw new Error('The Gipity SDK did not load');
  if (!configured) {
    g.auth.configure({ permissions: PERMISSIONS });
    configured = true;
  }
  return g;
}

/** The SDK's script tag, which deploy stamps with this app's hosting. */
function sdkTag() {
  return document.querySelector('script[src*="/client/v1/gipity.js"]');
}

/**
 * Where this page is, as far as Monitor cares:
 *   { kind: 'own-host' }            this Monitor's own origin: the dashboard runs
 *   { kind: 'moved', url }          Monitor runs on its own origin, but this is
 *                                   another address (app.gipity.ai): link there
 *   { kind: 'shared' }              Monitor hasn't moved yet: no account views
 */
export function hostingMode() {
  let g;
  try { g = sdk(); } catch { return { kind: 'shared' }; }
  const own = sdkTag()?.getAttribute('data-hosting') === 'own';
  if (!own) return { kind: 'shared' };
  // The SDK uses the same-origin /__gipity base only on a host deploy listed
  // for this app (its own gipity.app host comes first).
  if (g.app.apiBase === `${location.origin}/__gipity` && location.hostname.endsWith('.gipity.app')) {
    return { kind: 'own-host' };
  }
  const url = g.app.siteUrl;
  return url && /^https:\/\/[a-z0-9.-]+\.gipity\.app\//.test(url) ? { kind: 'moved', url } : { kind: 'shared' };
}

/** The same-origin API base on Monitor's own host (`https://<host>/__gipity`). */
export function apiBase() {
  return sdk().app.apiBase;
}

/** This app's token (public; it names the app, not the viewer). Cached, single-flight. */
export async function appToken() {
  if (tokenCache && tokenCache.expiresAt - TOKEN_REFRESH_BUFFER_MS > Date.now()) return tokenCache.token;
  if (tokenInflight) return tokenInflight;
  tokenInflight = (async () => {
    try {
      const started = Date.now();
      const res = await fetch(`${apiBase()}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: sdk().app.guid }),
      });
      if (!res.ok) throw new Error(`App token request failed (${res.status})`);
      const { data } = await res.json();
      tokenCache = { token: data.token, expiresAt: started + data.expiresIn * 1000 };
      return data.token;
    } finally {
      tokenInflight = null;
    }
  })();
  return tokenInflight;
}

/**
 * Sign in through the Gipity popup. It ends on this host's hand-off page,
 * which sets the session cookie here; the SDK then sees the session.
 * Must run inside the click handler (the popup opens synchronously).
 */
export async function signIn() {
  const user = await sdk().auth.signIn();
  if (!user) throw new Error('Sign-in was cancelled or not allowed');
  return user;
}

/** End Monitor's session on this host. Your Gipity sign-in elsewhere is left alone. */
export async function signOut() {
  await sdk().auth.signOut();
}

/**
 * Whether this viewer can use Monitor: signed in on this host and granted the
 * Account scope (which the platform reports only to the account owner here).
 */
export async function isSignedIn() {
  try {
    const s = await sdk().auth.status();
    return s.authenticated === true && s.consented === true;
  } catch {
    return false;
  }
}
