# Gipity Templates

Blank starting points for [Gipity](https://gipity.ai) apps: minimal framework wiring that deploys green, with nothing to delete. Run `gipity add <template>` in an empty project and build on top. For a complete working app to learn from or extend, see [`../apps/`](../apps/); for a building block to add into an existing app, see [`../kits/`](../kits/).

| Key | What |
|-----|------|
| [`web-simple`](web-simple/) | Static frontend-only web app - landing pages, dashboards, simple games. No backend. |
| [`web-fullstack`](web-fullstack/) | Web app with a backend API and database: frontend shell plus `functions/` and `migrations/`. |
| [`api`](api/) | Pure API backend, no frontend: one example function and a passing test. |
| [`3d-engine`](3d-engine/) | Minimal 3D multiplayer wiring - Three.js + Rapier + Colyseus, a ground plane and no gameplay. |

## Available Templates

### 3D Engine

The minimal 3D multiplayer template - same engine as 3D World, none of the demo content. Three.js + Rapier physics + Colyseus multiplayer wire up; `game.js` and `scene.js` ship with just a ground plane so you can drop your own game on top. Use it when you want a clean canvas.

```bash
gipity add 3d-engine --title "My 3D App"
```

## Using Templates Outside Gipity

These templates are designed for the Gipity platform, but the engine code is standard JavaScript with no proprietary dependencies. The 3D Engine template uses Three.js, Rapier, and Colyseus - all open-source libraries. You can use these files in any project.

## What is Gipity?

The full-stack platform tuned for AI agents.

[Gipity](https://gipity.ai) is the platform: hosting, databases, file storage, deployment, scheduled workflows, code execution, and monitoring. Agent-tuned from idea to deploy. No setup. No API keys. No config files.

Describe what you want. Your agent writes the code, builds the app, sets up the database, deploys it to a live URL, and keeps it running. From idea to production in one conversation. Any model, any infra, always your code.

**Get started:** `npm install -g gipity && gipity build` - launches your coding agent (Claude Code, Codex, or Grok) with the whole Gipity stack wired up.

## License

MIT
