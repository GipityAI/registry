# Gipity Templates

Project templates for [Gipity](https://gipity.ai) - the agent-tuned platform where AI-built apps live. Tell your AI agent what to build, and it handles the rest: code, hosting, databases, deployment, multiplayer, and more.

Templates are the starting points. Each one is production-ready with all files fully editable. Your AI agent (or you) writes the creative part - the template handles the infrastructure.

Every template is one of two kinds:

- **Templates** - minimal framework wiring (e.g. `web-simple`, `3d-engine`). Blank slate for new builds.
- **Starter apps** - complete working demos (e.g. `3d-world`, `web-fullstack`, `2d-game`, `api`). Playable reference you can learn from or extend.

To add a reusable building block (e.g. multiplayer) into an *existing* app, use a **kit** instead - see the sibling `kits/` directory in this registry.

## Available Templates

### 3D Engine

The minimal 3D multiplayer template - same engine as 3D World, none of the demo content. Three.js + Rapier physics + Colyseus multiplayer wire up; `game.js` and `scene.js` ship with just a ground plane so you can drop your own game on top. Use it when you want a clean canvas.

```bash
gipity add 3d-engine --title "My 3D App"
```

### 3D World

A playable 3D multiplayer starter - a rocket-launcher demo built on the 3D Engine template. Same stack, plus a camera-orbiting player, voxel demo scene, rocket projectiles, explosions, and sounds. Use it as a reference or a playground.

**Stack:** Three.js (rendering) + Rapier (physics) + Colyseus (multiplayer networking)

**What you get:**
- Real-time 3D rendering
- Physics (gravity, collisions, constraints)
- Multiplayer out of the box (rooms, state sync, player identity)
- Camera modes (orbit, first-person, top-down, fixed)
- World primitives (parts, spawn points, lighting, fog, time-of-day)
- Sub-voxel shape system (3x3x3 grid per part - stairs, slopes, arches)
- Debug panel, info panels, in-game UI system
- Asset loading from CDN

**Build with it:** Obby/parkour, tycoon, simulator, PvP combat, shooter, tower defense, horror, racing, RPG, social spaces, chat rooms, virtual events.

```bash
# Via Gipity CLI
gipity add 3d-world --title "My World"

# Via Gipity web agent
add name=3d-world title="My World"
```

**Project structure:**
```
src/
  js/
    core.js         # Engine - game loop, boot, module exports
    world.js        # Three.js scene, renderer, lighting
    physics.js      # Rapier physics world
    assets.js       # CDN asset loader
    player.js       # Character controller, camera
    network.js      # Colyseus multiplayer
    ui.js           # HUD, loading screen
    primitives.js   # Part system, workspace, snap
    constraints.js  # Weld, hinge, spring joints
    config.js       # Game metadata (title, version)
    settings.js     # Tunable values (speed, gravity, etc.)
    strings.js      # Display text
    objects.js      # Entity factories
    game.js         # Game orchestrator - your main logic
  css/
    engine.css      # Engine UI styles
    game.css        # Your custom styles
  index.html
```

All files are fully editable.

*More templates coming soon: web app, mobile game, enterprise web app, and more.*

## Using Templates Outside Gipity

These templates are designed for the Gipity platform, but the engine code is standard JavaScript with no proprietary dependencies. The 3D World template uses Three.js, Rapier, and Colyseus - all open-source libraries. You can use these files in any project.

## What is Gipity?

The agent-tuned platform where AI-built apps live.

[Gipity](https://gipity.ai) is the platform: hosting, databases, file storage, deployment, scheduled workflows, code execution, and monitoring. Agent-tuned from idea to deploy. One place - not seven SaaS products stitched together. No setup. No API keys. No config files.

Describe what you want. Your agent writes the code, builds the app, sets up the database, deploys it to a live URL, and keeps it running. From idea to production in one conversation. Any model, any infra, always your code.

**Get started:** `npm install -g gipity && gipity claude`

## License

MIT
