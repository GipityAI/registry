/**
 * @gipity/notify — web push notifications for your app, including iOS home-screen
 * web apps. The platform owns the VAPID keys, encryption, and delivery (Gipity
 * Notify); this is the thin browser layer that subscribes the device and renders
 * a button. No keys, no service-worker boilerplate, no crypto.
 *
 * Setup (two lines in your page):
 *   <link rel="manifest" href="manifest.webmanifest">      // lets iOS install to Home Screen
 *   <script type="module">import '@gipity/notify';</script> // defines <gipity-notify-button>
 *
 * Then drop the button anywhere:
 *   <gipity-notify-button>Turn on notifications</gipity-notify-button>
 *
 * Send from a function (owner-billed, one flat credit per send):
 *   export default async function (ctx, { notify }) {
 *     await notify({ to: someUserGuid, notification: { title: 'Game on!', body: '6pm pickleball', url: '/events/1' } });
 *   }
 *
 * Or test from the CLI:  gipity notify test --to all
 */

// Resolve the service worker next to this module (src/packages/notify/sw-notify.js)
// regardless of which page imports it. Its scope is the package dir, which is all
// push needs — the SW receives push events and opens windows independent of scope.
const SW_URL = new URL('./sw-notify.js', import.meta.url);

function G() {
  if (typeof window === 'undefined' || !window.Gipity) {
    throw new Error('@gipity/notify needs the Gipity client SDK — ensure the gipity.js <script data-app="..."> tag is present.');
  }
  return window.Gipity;
}

const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);

const pushSupported = () =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
  typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;

/**
 * Where the user is in the notification flow:
 *   'unsupported'      — this browser can't do web push
 *   'ios-needs-install'— iOS, but the app isn't added to the Home Screen yet (required by Apple)
 *   'denied'           — the user blocked notifications
 *   'enabled'          — subscribed and on
 *   'ready'            — supported and permitted, just not subscribed yet
 */
export async function getNotifyState() {
  if (isIOS() && !isStandalone()) return 'ios-needs-install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const existing = reg && (await reg.pushManager.getSubscription());
  return existing ? 'enabled' : 'ready';
}

/** A short, human explanation for a non-enabled state (drives the button UI). */
export function explainState(state) {
  switch (state) {
    case 'ios-needs-install': return 'Add this app to your Home Screen first (Share → Add to Home Screen), then open it and tap again.';
    case 'unsupported': return 'This browser doesn’t support notifications.';
    case 'denied': return 'Notifications are blocked. Re-enable them in your browser settings.';
    default: return '';
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registerSw() {
  return navigator.serviceWorker.register(SW_URL);
}

function toJSON(sub) {
  const json = sub.toJSON();
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
}

/**
 * Turn on notifications for the signed-in user: registers the service worker,
 * asks permission, subscribes, and stores the subscription with the platform.
 * Requires a signed-in Gipity user (push is per-user); kicks off sign-in if needed.
 * Returns the new state ('enabled', 'denied', or an unsupported state).
 */
export async function enableNotify() {
  const state = await getNotifyState();
  if (state === 'unsupported' || state === 'ios-needs-install' || state === 'denied') return state;

  // Push targets a user, so we need someone signed in.
  let user = await G().auth.user().catch(() => null);
  if (!user) user = await G().auth.signIn().catch(() => null);
  if (!user) return 'ready'; // user dismissed sign-in

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'ready';

  const reg = await registerSw();
  await navigator.serviceWorker.ready;

  const { vapidPublicKey } = await G().service('notify/config', null, { method: 'GET' });
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }
  await G().service('notify/subscribe', toJSON(sub));
  return 'enabled';
}

/** Turn off notifications for this device. */
export async function disableNotify() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) {
    await G().service('notify/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return 'ready';
}

/**
 * Self-heal: if this device already has a local subscription, re-register it with
 * the platform. iOS silently invalidates subscriptions and a server row can be
 * pruned, which otherwise leaves the button stuck on "you're all set" while no
 * notifications arrive. Safe to call on every page load.
 */
export async function syncSubscription() {
  try {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub && (await G().auth.user().catch(() => null))) {
      await G().service('notify/subscribe', toJSON(sub));
    }
  } catch { /* best-effort */ }
}

/**
 * <gipity-notify-button> — a self-contained enable/disable button that reflects
 * the current state and handles the iOS install hint. Auto-defined on import.
 */
export function defineNotifyButton() {
  if (typeof window === 'undefined' || typeof HTMLElement === 'undefined') return;
  if (customElements.get('gipity-notify-button')) return;

  class NotifyButton extends HTMLElement {
    async connectedCallback() {
      if (this._wired) return;
      this._wired = true;
      this._label = this.textContent.trim() || 'Turn on notifications';
      this.textContent = '';
      this._btn = document.createElement('button');
      this._btn.type = 'button';
      if (this.getAttribute('button-class')) this._btn.className = this.getAttribute('button-class');
      this._hint = document.createElement('p');
      this._hint.style.cssText = 'font-size:0.85em;opacity:0.8;margin:0.4em 0 0;';
      this.appendChild(this._btn);
      this.appendChild(this._hint);
      this._btn.addEventListener('click', () => this._onClick());
      await syncSubscription();
      this._render(await getNotifyState());
    }

    _render(state) {
      const msg = explainState(state);
      this._hint.textContent = msg;
      if (state === 'enabled') { this._btn.textContent = '✓ Notifications on'; this._btn.disabled = false; }
      else if (state === 'ready') { this._btn.textContent = this._label; this._btn.disabled = false; }
      else { this._btn.textContent = this._label; this._btn.disabled = (state !== 'ios-needs-install'); }
      this._state = state;
    }

    async _onClick() {
      this._btn.disabled = true;
      try {
        const next = this._state === 'enabled' ? await disableNotify() : await enableNotify();
        this._render(next);
        this.dispatchEvent(new CustomEvent('notifystatechange', { detail: { state: next }, bubbles: true }));
      } catch (err) {
        this._hint.textContent = (err && err.message) || 'Something went wrong.';
        this._btn.disabled = false;
      }
    }
  }

  customElements.define('gipity-notify-button', NotifyButton);
}

defineNotifyButton();
