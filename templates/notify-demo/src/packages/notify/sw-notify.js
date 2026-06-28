/**
 * Gipity Notify service worker. Receives encrypted web-push messages and shows
 * them; opens the notification's URL on click. Scaffolded into your app on
 * `gipity add notify` — edit freely (e.g. change the default icon or click behavior).
 */

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
        if ('focus' in client) { client.navigate(url); return client.focus(); }
      }
      return self.clients.openWindow(url);
    }),
  );
});
