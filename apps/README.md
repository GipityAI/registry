# Gipity Apps

Complete, working [Gipity](https://gipity.ai) apps: run one as-is, learn from it, then extend or replace its parts. Install with `gipity add <app>` in an empty project. Apps don't have to be production-ready to live here; a few are marked incomplete below.

| Key | What |
|-----|------|
| [`web-vision-cam`](web-vision-cam/) | Fullscreen camera app with on-device gesture / object / pose detection (the `web-vision-mediapipe` kit). |
| [`object-spotter`](object-spotter/) | Camera app that boxes, labels and counts objects in real time (the `web-vision-detect` kit, YOLOX on-device). |
| [`2d-game`](2d-game/) | 2D Phaser 3 game - platformer, arcade, puzzle, endless runner. |
| [`3d-world`](3d-world/) | Playable 3D multiplayer rocket-launcher demo, built on the `3d-engine` template. |
| [`karaoke-captions`](karaoke-captions/) | Audio + lyrics to word-by-word timing JSON (the `audio-align` kit, a GPU job). |
| [`paid-app`](paid-app/) | Storefront that charges real money: Stripe checkout, subscriptions, a members area (the `stripe` kit). |
| [`notify-demo`](notify-demo/) | Web push demo: turn on notifications, send a real ping (the `notify` kit). |
| [`monitor`](monitor/) | The account dashboard every Gipity account gets: traffic, errors, spend, functions, jobs. Auto-installed; add your own copy to customize it. |
| [`app-itsm`](app-itsm/) | IT service management: incidents, knowledge base, SLAs, service catalog, agent and employee portals. Hidden from listings; install by key. |
| [`outreach-agent`](outreach-agent/) | **Incomplete.** A staged outreach-email funnel. Its LLM steps were built for the retired chat agent (Gmail tools, agent memory) and need porting to workflow `tools:` before it runs. Hidden from listings. |

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

## Using Apps Outside Gipity

These apps are built for the Gipity platform, but the front-end code is standard JavaScript. 3D World uses Three.js, Rapier and Colyseus; 2D Game uses Phaser 3 - all open-source libraries you can use in any project.

## License

MIT
