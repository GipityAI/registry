/**
 * Sign-in-with-Gipity flow for the Monitor app.
 *
 * We don't need an app token because we read /account/logs/* which is
 * session-cookie-authenticated. We use the SiwG popup just to land the
 * session cookie on the platform API host, then the API client uses
 * credentials: 'include' for subsequent requests.
 */
const APP_GUID = '{{PROJECT_GUID}}';
const API_BASE = '{{API_BASE}}';

/**
 * Open the consent/login popup, wait for the postMessage handshake from
 * api-auth-renderers.ts:renderPopupResult, then close. The `mode=popup`
 * query param is what tells the server to use the postMessage flow instead
 * of the "you can close this" static page.
 */
export function signIn() {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE}/api/auth/login?app=${encodeURIComponent(APP_GUID)}&permissions=1&mode=popup`;
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

    // Detect manual close. Only reject if we never got the handshake — otherwise
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

/** Probe whether the session cookie is valid by hitting a cheap authed endpoint. */
export async function isSignedIn() {
  try {
    const res = await fetch(`${API_BASE}/account/logs/stats?range=1h`, { credentials: 'include' });
    return res.status === 200;
  } catch {
    return false;
  }
}
