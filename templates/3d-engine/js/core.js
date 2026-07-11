/**
 * 3D World - Core Module
 * Game loop and re-exports all engine modules.
 *
 * Game code imports from this file:
 *   import { world, assets, physics, player, network, ui, THREE } from './core.js';
 */
const TEMPLATE_VERSION = 117;

// Re-export all modules
import { scene, camera, renderer, clock, THREE, lighting } from './world.js';
import * as physics from './physics.js';
import * as assets from './assets.js';
import * as playerModule from './player.js';
import * as network from './network.js';
import * as ui from './ui.js';
import * as primitives from './primitives.js';
import * as constraints from './constraints.js';
import * as features from './features.js';

const world = { scene, camera, renderer, clock, lighting };

// Wire workspace.lighting reference
primitives.workspace.lighting = lighting;

// Expose spawn position function for player.js to use
window._gip3dwGetSpawnPosition = primitives.getSpawnPosition;

// Game hooks - set by game code
let gameInit = null;
let gameUpdate = null;
let gameConfig = null;
let statsTimer = 0;

// Boot readiness - resolved when game.js registers its hooks
let resolveGameReady;
const gameReady = new Promise((r) => { resolveGameReady = r; });

// Run readiness - resolved once boot finished and the frame loop is running.
// `whenReady()` hands this to verification code so it can await the real boot
// instead of guessing at a sleep.
let resolveRunning;
const running = new Promise((r) => { resolveRunning = r; });

/** Register game initialization function. Called after template is ready. */
function onInit(fn) {
  gameInit = fn;
  // game.js has registered - signal boot can proceed
  resolveGameReady();
}

/** Register game update function. Called every frame with (dt). */
function onUpdate(fn) { gameUpdate = fn; }

/** Set game configuration */
function setConfig(config) {
  gameConfig = config;
  if (config.title) {
    document.title = config.title;
    ui.setLoadingTitle(config.title);
  }
}

// --- Boot sequence ---
async function boot() {
  try {
    // Log game version info
    const version = gameConfig?.version || '?';
    const title = gameConfig?.title || '3D World';
    console.log(`[3D World] ${title} v${version} | Template v${TEMPLATE_VERSION}`);

    ui.updateLoadingProgress(0.05, 'Initializing physics...');
    await physics.initPhysics();

    ui.updateLoadingProgress(0.15, 'Loading assets...');
    await assets.initAssets((p, msg) => ui.updateLoadingProgress(0.15 + p * 0.2, msg));

    // Preload assets from config
    if (gameConfig?.preload?.length) {
      await assets.preload(gameConfig.preload, (p, msg) => ui.updateLoadingProgress(0.35 + p * 0.3, msg));
    }

    ui.updateLoadingProgress(0.7, 'Starting game...');

    // Call game init
    if (gameInit) {
      await gameInit();
    } else {
      console.warn('[Core] No gameInit registered - scene will be empty');
    }

    // Initialize opt-in features (after game init so game code can set up first).
    // Multiplayer is a feature now: when enabled it opens the Colyseus
    // connection + wires position sync; when disabled, network.* calls
    // become no-ops and the game runs purely offline.
    ui.updateLoadingProgress(0.85, 'Loading features...');
    await features.initFeatures(gameConfig?.features, {
      world, scene, camera, renderer, physics, player: playerModule,
      network, ui, assets, primitives, constraints, THREE,
    });

    ui.updateLoadingProgress(1, 'Ready!');

    // Feed version info to debug panel
    ui.setDebugInfo({
      fwVersion: TEMPLATE_VERSION,
      appVersion: version,
      appTitle: title,
    });

    // Connect to platform event stream (auto-refresh on deploy, future events)
    connectPlatformEvents();

    // Start game loop
    setTimeout(() => {
      ui.hideLoading();
      requestAnimationFrame(loop);
      resolveRunning();
    }, 300);

  } catch (err) {
    console.error('[Core] Boot failed:', err);
    ui.updateLoadingProgress(1, `Error: ${err.message}`);
  }
}

/** Connect to platform SSE for real-time events (deploy reload, future: config, notify, kill) */
function connectPlatformEvents() {
  const meta = document.querySelector('meta[name="gipity-app"]');
  if (!meta || !meta.content) return; // no app GUID = not deployed, skip

  const appGuid = meta.content;
  const apiBase = 'https://a.gipity.ai';

  try {
    const es = new EventSource(`${apiBase}/api/${appGuid}/events`);

    es.addEventListener('deploy', () => {
      console.log('[3D World] New version deployed, reloading...');
      const toast = document.createElement('div');
      toast.textContent = 'Updating\u2026';
      toast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.85);color:#fea60b;padding:16px 32px;border-radius:8px;font:16px monospace;z-index:99999;pointer-events:none;';
      document.body.appendChild(toast);
      setTimeout(() => location.reload(), 800);
    });

    // Future: es.addEventListener('config', (e) => { ... });
    // Future: es.addEventListener('notify', (e) => { ... });
    // Future: es.addEventListener('kill', (e) => { ... });

    es.onerror = () => console.debug('[3D World] Event stream reconnecting...');
  } catch {
    // EventSource not supported or blocked - game works fine without it
  }
}

/** One step of world time: everything the frame advances except rendering and
 *  the debug HUD. `loop()` and `advance()` both go through here, so stepping
 *  the world headlessly exercises the same code path a real frame does -
 *  physics, part sync, player, game logic, features. */
function simulate(dt) {
  physics.step(dt);
  primitives.updateParts(dt); // sync physics → meshes, run snap detection
  playerModule.updatePlayer(dt);

  if (gameUpdate) gameUpdate(dt);
  features.updateFeatures(dt);
}

/** Advance the world by `seconds` at a fixed step, without rendering. Returns
 *  the number of steps taken.
 *
 *  Use this to verify time-dependent behavior (a collision, a fall, an
 *  animation settling) instead of waiting on wall-clock time. A headless
 *  browser software-renders this scene at ~2-3 fps, and `loop()` caps dt at
 *  1/30s to keep physics stable, so world time there crawls at roughly a
 *  twelfth of real time: sleeping 3s and asserting on the result reports that
 *  the collision never happened. Stepping directly costs ~0.6ms per step
 *  rather than ~385ms, and is deterministic - the same `seconds` gives the
 *  same outcome on any machine, headless or not.
 *
 *      const core = await import('./js/core.js');
 *      await core.whenReady();
 *      core.advance(3);            // 3 seconds of world time, ~110ms real
 *
 *  Synchronous on purpose: a run of steps that never yields cannot be
 *  interleaved by requestAnimationFrame, so `loop()` can't slip a
 *  variable-dt frame into the middle of an advance. */
function advance(seconds, { dt = 1 / 60 } = {}) {
  if (!(seconds > 0)) return 0;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) simulate(dt);
  // Absorb the wall-clock time those steps burned. Without this the next real
  // frame sees a large delta and steps the world a second time for the same
  // span (capped, but still a visible jump).
  clock.update();
  return steps;
}

function loop() {
  requestAnimationFrame(loop);
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.05); // Cap delta to avoid spiraling

  simulate(dt);

  ui.updateDebugFps(dt);
  // Update part count in debug panel (piggyback on FPS timer - once per second)
  ui.setDebugInfo({ partCount: primitives.workspace.parts.size });

  // Feed renderer/physics stats to debug panel (~4Hz)
  statsTimer += dt;
  if (statsTimer > 0.25) {
    statsTimer = 0;
    const info = renderer.info;
    let awake = 0;
    if (physics.world) {
      physics.world.forEachRigidBody((b) => { if (!b.isSleeping()) awake++; });
    }
    ui.setRendererInfo({
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      sceneObjects: scene.children.length,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      bodies: physics.world ? physics.world.bodies.len() : 0,
      awake,
    });
  }

  renderer.render(scene, camera);
}

// Wait for game code to call onInit(), then boot
// gameReady resolves when onInit() is called, with a 5s safety timeout
Promise.race([
  gameReady,
  new Promise((_, reject) => setTimeout(() => reject(new Error('game.js did not call onInit() within 5 seconds')), 5000)),
]).then(boot).catch((err) => {
  console.error('[Core]', err.message);
  ui.updateLoadingProgress(1, `Error: ${err.message}`);
});

// Re-export workspace at top level for convenience
const { workspace } = primitives;

/** Resolves once boot has finished and the frame loop is running. Await this
 *  before driving the world from a `gipity page eval` script. */
function whenReady() { return running; }

export {
  world,
  assets,
  physics,
  playerModule as player,
  network,
  ui,
  THREE,
  onInit,
  onUpdate,
  setConfig,
  // Deterministic, render-free stepping for headless verification
  advance,
  whenReady,
  // v13+ World Primitives
  primitives,
  constraints,
  workspace,
  features,
  TEMPLATE_VERSION,
};
