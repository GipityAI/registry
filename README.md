# Gipity Registry

The catalog of things [Gipity](https://gipity.ai) apps can `add` — project templates and reusable kits. This is what `gipity add <name>` pulls from.

## Two kinds of things

### Templates

A **template** installs a whole app. Run `gipity add <template>` in an empty project; it lays down `src/`, framework wiring, and any starter content. One template per project.

Templates are further split by `kind`:

- **`kind: 'template'`** — minimal framework wiring. No demo content. Start here to build something new.
- **`kind: 'starter'`** — a complete working demo. Useful as a playable reference; meant to be replaced or extended.

| Key | Kind | What |
|------|------|-------|
| [`web-simple`](templates/web-simple/) | template | Static frontend-only web app — landing page, dashboard, simple game. No backend. |
| [`3d-engine`](templates/3d-engine/) | template | Minimal 3D multiplayer wiring — Three.js + Rapier physics + Colyseus, no gameplay. |
| [`web-fullstack`](templates/web-fullstack/) | starter | Web app with backend API + database. Weather-by-zip demo included. |
| [`web-vision-cam`](templates/web-vision-cam/) | starter | Fullscreen camera app with on-device gesture/pose/object detection. |
| [`2d-game`](templates/2d-game/) | starter | 2D Phaser 3 game — platformer/arcade/puzzle. |
| [`3d-world`](templates/3d-world/) | starter | Playable 3D multiplayer rocket-launcher demo, built on `3d-engine`. |
| [`api`](templates/api/) | starter | Pure API backend (no frontend) — weather-by-zip endpoint with tests. |

### Kits

A **kit** installs a reusable building block into an *existing* app. Files land under `src/packages/<kit>/`, with the import map and `gipity.yaml` wired up automatically. Many kits per project.

| Key | What |
|------|-------|
| [`realtime`](kits/realtime/) | Multiplayer / presence / shared state — channels, host election, server-persisted sync. Engine-agnostic. |
| [`web-vision-mediapipe`](kits/web-vision-mediapipe/) | Browser computer vision — gesture, body pose, object detection via MediaPipe. Client-side only. |

## How `gipity add` resolves a name

```
gipity add web-simple --title "My app"   # template — needs an empty project
gipity add realtime                       # kit — installs into the current app
```

Dispatch is by catalog membership: a name in the templates table installs a whole app; a name in the kits table installs into the existing one. The catalog itself is defined in code at [`platform/packages/shared/src/constants.ts`](https://github.com/GipityAI/registry) in the main Gipity repo — keep this README and that source in sync when adding entries.

## Repo layout

```
registry/
├── templates/        # whole-app scaffolds
│   ├── _shared/      # canonical source for non-kit code reused across templates
│   ├── web-simple/
│   ├── 3d-engine/
│   ├── 3d-world/
│   ├── web-fullstack/
│   ├── web-vision-cam/
│   ├── 2d-game/
│   ├── api/
│   └── README.md     # user-facing template docs
└── kits/             # reusable building blocks
    ├── realtime/
    └── web-vision-mediapipe/
```

The `_shared/` directory holds canonical files (e.g. the weather example used by `web-fullstack` and `api`) that get synced into each consuming template. Run `npx tsx scripts/sync-registry.ts` after editing any file under `_shared/` or any kit referenced by a template; CI uses `--check` to fail on drift.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev loop, how to add a new template or kit, and what tests are required.

## License

[MIT](LICENSE). Templates and kits are designed for the Gipity platform, but the code is standard JavaScript/HTML with no proprietary dependencies — feel free to lift anything you find useful.

## What is Gipity?

The agent-tuned platform where AI-built apps live: hosting, databases, file storage, deployment, scheduled workflows, code execution, monitoring. Agent-tuned from idea to deploy.

Describe what you want. Your agent writes the code, builds the app, sets up the database, deploys it to a live URL, and keeps it running.

Get started: `npm install -g gipity && gipity claude`. More at [gipity.ai](https://gipity.ai).
