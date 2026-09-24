# Gipity Registry

The catalog of things [Gipity](https://gipity.ai) apps can `add` — project templates and reusable kits. This is what `gipity add <name>` pulls from.

## Three kinds of things

Each kind has its own directory. `gipity add <name>` dispatches on which one a name belongs to.

### Templates - [`templates/`](templates/)

Minimal framework wiring for an **empty** project: it lays down `src/` and the wiring, deploys green, and has nothing to delete. Start here to build something new. One per project.

| Key | What |
|-----|------|
| [`web-simple`](templates/web-simple/) | Static frontend-only web app - landing page, dashboard, simple game. No backend. |
| [`web-fullstack`](templates/web-fullstack/) | Web app with a backend API and database - frontend shell, `functions/`, `migrations/`. |
| [`api`](templates/api/) | Pure API backend (no frontend) - one example function and a passing test. |
| [`3d-engine`](templates/3d-engine/) | Minimal 3D multiplayer wiring - Three.js + Rapier physics + Colyseus, no gameplay. |

### Apps - [`apps/`](apps/)

A **complete, working app** for an empty project: run it as-is, learn from it, then extend or replace it. A demo or a vertical; it doesn't have to be production-ready. One per project.

| Key | What |
|-----|------|
| [`web-vision-cam`](apps/web-vision-cam/) | Fullscreen camera app with on-device gesture/pose/object detection. |
| [`object-spotter`](apps/object-spotter/) | Camera app that boxes, labels and counts objects in real time. |
| [`2d-game`](apps/2d-game/) | 2D Phaser 3 game - platformer/arcade/puzzle. |
| [`3d-world`](apps/3d-world/) | Playable 3D multiplayer rocket-launcher demo, built on `3d-engine`. |
| [`karaoke-captions`](apps/karaoke-captions/) | Audio + lyrics to word-synced karaoke captions (GPU job). |
| [`paid-app`](apps/paid-app/) | Storefront that charges real money via Stripe. |
| [`notify-demo`](apps/notify-demo/) | Web push notifications demo. |
| [`monitor`](apps/monitor/) | The per-account dashboard (auto-installed; add your own copy to customize). |
| [`app-itsm`](apps/app-itsm/) | IT service management (hidden from listings). |
| [`outreach-agent`](apps/outreach-agent/) | Outreach-email funnel - incomplete, hidden from listings. |

### Kits - [`kits/`](kits/)

A **reusable building block** added into an *existing* app. Files land under `src/packages/<kit>/`, with the import map and `gipity.yaml` wired up automatically. Many kits per project.

| Key | What |
|-----|------|
| [`realtime`](kits/realtime/) | Multiplayer / presence / shared state - channels, host election, server-persisted sync. Engine-agnostic. |
| [`web-vision-mediapipe`](kits/web-vision-mediapipe/) | Browser computer vision - gesture, body pose, object detection via MediaPipe. Client-side only. |
| [`web-vision-detect`](kits/web-vision-detect/) | High-accuracy browser object detection - YOLOX on ONNX Runtime Web. Client-side only. |
| [`chatbot`](kits/chatbot/) | Drop-in chatbot - persona, scope guardrails, static knowledge, streaming. |
| [`audio-align`](kits/audio-align/) | Forced audio alignment: audio + lyrics to word-level timing (GPU job). |
| [`i18n`](kits/i18n/) | Multi-language - language picker, locale persistence, RTL, translation lookup. |
| [`contacts`](kits/contacts/) | Contact data layer - imports, de-duplication with provenance, tags, search. Needs a database template. |
| [`integrations/servicenow`](kits/integrations/servicenow/) | ServiceNow tables as a data source - polling pull, write-back, optional webhook sync. |
| [`stripe`](kits/stripe/) | Charge end-users via Stripe Connect - checkout, subscriptions, billing portal. |
| [`notify`](kits/notify/) | Web push notifications (Gipity Notify), including iOS home-screen web apps. |

## How `gipity add` resolves a name

```
gipity add web-simple --title "My app"   # template - needs an empty project
gipity add 2d-game                        # app - needs an empty project
gipity add realtime                       # kit - installs into the current app
```

The catalog is defined in code in the main Gipity repo (`platform/packages/shared/src/constants.ts`, `TEMPLATES` with `kind: 'template' | 'app'`, and `KITS`); each entry's `dir` is its path in this repo. Keep this README and that source in sync when adding entries.

## Repo layout

```
registry/
├── templates/   # blank wiring for a new app
├── apps/        # complete working apps
├── kits/        # building blocks for an existing app
└── _shared/     # canonical non-kit code synced into templates and apps
```

`_shared/` holds canonical files (e.g. the `gipity-theme.css` brand theme used by the Water.css templates) that are synced into each consumer. Run `npx tsx platform/scripts/sync-registry.ts` after editing anything under `_shared/` or a kit that ships inside a template or app; CI uses `--check` to fail on drift.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev loop, how to add a new template or kit, and what tests are required.

## License

[MIT](LICENSE). Templates and kits are designed for the Gipity platform, but the code is standard JavaScript/HTML with no proprietary dependencies — feel free to lift anything you find useful.

## What is Gipity?

The full-stack platform tuned for AI agents: hosting, databases, file storage, deployment, scheduled workflows, code execution, monitoring. Agent-tuned from idea to deploy.

Describe what you want. Your agent writes the code, builds the app, sets up the database, deploys it to a live URL, and keeps it running.

Get started: `npm install -g gipity && gipity build` - launches your coding agent (Claude Code, Codex, or Grok) with the whole Gipity stack wired up. More at [gipity.ai](https://gipity.ai).
