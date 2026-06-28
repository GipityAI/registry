# @gipity/notify — Gipity Notify (web push)

Web push notifications for your app, including **iOS home-screen web apps** (iOS 16.4+). The platform owns the VAPID keys, RFC 8291 encryption, and delivery — you never touch crypto or paste a key.

## Install

```bash
gipity add notify
```

This wires `@gipity/notify` into your import map, scaffolds a PWA `manifest.webmanifest`, and ships the service worker + icons under `src/packages/notify/`.

## Use it (two lines in your page)

```html
<!-- in <head>: lets iOS install the app to the Home Screen (required for iOS push) -->
<link rel="manifest" href="manifest.webmanifest">

<!-- anywhere: defines and renders the button -->
<script type="module">import '@gipity/notify';</script>
<gipity-notify-button>Turn on notifications</gipity-notify-button>
```

The button handles everything: it signs the user in if needed, asks permission, subscribes the device, and self-heals a stale subscription on load. On iOS it shows the "Add to Home Screen first" hint until the app is installed.

## Send a notification (from a function)

Declare the service and call the injected `notify()` — one flat credit per send, billed to you (the app owner):

```js
// functions/notify-event/index.js   →   gipity.yaml: services: ['notify']
export default async function (ctx, { notify }) {
  await notify({
    to: someUserGuid,                 // a user guid, an array of guids, or 'all'
    notification: { title: 'Game on!', body: '6pm pickleball', url: '/events/1' },
  });
  return { ok: true };
}
```

`to` uses the same user guid your app already knows (`ctx.auth.userGuid`). Dead subscriptions are pruned automatically.

## Test it

```bash
gipity notify test --to all          # send yourself / everyone a test push
gipity notify subs                   # how many devices are subscribed, per user
```

## Notes

- **iOS** only delivers push to web apps **installed to the Home Screen** (Apple's rule) on **iOS 16.4+**. Desktop Chrome/Edge/Firefox and Android Chrome work in a normal tab.
- The JS API is also available directly: `import { enableNotify, disableNotify, getNotifyState } from '@gipity/notify'`.
- Edit `src/packages/notify/sw-notify.js` to change the notification icon or click behavior; edit `src/manifest.webmanifest` to set your app name and icons.
