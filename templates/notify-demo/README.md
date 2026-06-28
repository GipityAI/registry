# Notify demo

A tiny working demo of **Gipity Notify** — real web push notifications, including on an iPhone added to the Home Screen. Built on `web-fullstack` with the `notify` kit pre-installed.

What it does:

1. **Turn on notifications** — the `<gipity-notify-button>` signs the user in, asks permission, and subscribes the device. On iPhone it shows the "Add to Home Screen first" hint (Apple requires installed web apps for push).
2. **Send a ping** — the `send-ping` function calls the injected `notify()` service. The platform encrypts, signs (VAPID), and delivers; dead subscriptions are pruned automatically.

No database, no keys, no service-worker boilerplate to write.

## Build & deploy

```bash
gipity deploy dev
```

Open the dev URL, turn on notifications, and tap **Send me a ping**. Or send from the terminal:

```bash
gipity notify test --to all      # push to every subscriber
gipity notify subs               # how many devices are subscribed
```

## Make it yours

- `functions/send-ping/index.js` — what gets sent (declare `services: ['notify']` to use `notify()`).
- `src/js/main.js` / `src/index.html` — the UI.
- `src/manifest.webmanifest` — app name + Home Screen icon.

Send to a specific user from any function: `await notify({ to: userGuid, notification: { title, body, url } })`.
