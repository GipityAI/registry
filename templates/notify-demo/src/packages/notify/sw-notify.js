/**
 * Gipity Notify service worker. Receives encrypted web-push messages and shows
 * them; opens the notification's URL on click. Scaffolded into your app on
 * `gipity add notify` — edit freely (e.g. change the default icon or click behavior).
 *
 * Note: this worker is registered with a sub-scope (…/packages/notify/) and does
 * NOT control the app page. Receiving push and opening windows works regardless;
 * but it can't navigate() a page it doesn't control, so on click it focuses an
 * open tab and posts the URL for the page to route itself.
 */

// Take over as soon as an updated worker is installed so SW fixes reach users
// without a manual unregister (paired with registration.update() on the page).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Notification';
  const options = {
    body: data.body || '',
    icon: data.icon || 'icons/icon-192.png',
    badge: data.badge || 'icons/icon-192.png',
    tag: data.tag,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          // We don't control this page, so we can't navigate() it — focus it and
          // post the URL; the page routes itself (see listenForNotificationClicks).
          client.postMessage({ type: 'gipity-notify-click', url });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
