/**
 * Sign-in-with-Gipity flow for the Monitor app.
 *
 * Monitor is a normal app in your account. It reads and manages your account
 * through the platform API by proving two things on every call: which app is
 * asking (its app token, X-App-Token) and who is looking (the session cookie).
 * The platform honors that only when the viewer owns this app and granted it
 * the Account scope, so your Monitor reaches your account and nobody else's
 * app ever can.
 */
const APP_GUID = '{{PROJECT_GUID}}';
const API_BASE = '{{API_BASE}}';

// Identity (1) + Account (128). Account is only ever granted to an app you own.
const PERMISSIONS = 1 | 128;

// Refresh the app token a minute before it expires.
const TOKEN_REFRESH_BUFFER_MS = 60_000;
let tokenCache = null;
let tokenInflight = null;

/** This app's token (public; it names the app, not the viewer). Cached, single-flight. */
export async function appToken() {
  if (tokenCache && tokenCache.expiresAt - TOKEN_REFRESH_BUFFER_MS > Date.now()) return tokenCache.token;
  if (tokenInflight) return tokenInflight;
  tokenInflight = (async () => {
    try {
      const started = Date.now();
      const res = await fetch(`${API_BASE}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: APP_GUID }),
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
 * Open the consent/login popup, wait for the postMessage handshake from
 * api-auth-renderers.ts:renderPopupResult, then close. The `mode=popup`
 * query param is what tells the server to use the postMessage flow instead
 * of the "you can close this" static page.
 */
export function signIn() {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE}/api/auth/login?app=${encodeURIComponent(APP_GUID)}&permissions=${PERMISSIONS}&mode=popup`;
    const popup = window.open(url, 'gipity_signin', 'width=480,height=640');
    if (!popup) {
      reject(new Error('Popup blocked'));
      return;
    }
    let settled = false;
    const onMessage = (ev) => {
      if (ev.origin !== API_BASE) return;
      if (ev.data?.type !== 'gipity_auth') return;
      settled = true;
      window.removeEventListener('message', onMessage);
      try { popup.close(); } catch { /* already closed */ }
      if (ev.data.status === 'success') resolve();
      else reject(new Error('Permission denied'));
    };
    window.addEventListener('message', onMessage);

    // Detect manual close. Only reject if we never got the handshake - otherwise
    // the popup may close naturally after posting (and `popup.closed === true`
    // races with our message listener).
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed);
        if (!settled) {
          window.removeEventListener('message', onMessage);
          reject(new Error('Sign-in cancelled'));
        }
      }
    }, 500);
  });
}

/** Probe whether this viewer can use Monitor (signed in, owns it, granted Account). */
export async function isSignedIn() {
  try {
    const res = await fetch(`${API_BASE}/account/logs/stats?range=1h`, {
      credentials: 'include',
      headers: { 'X-App-Token': await appToken() },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
