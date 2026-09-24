// Game configuration - Phaser setup and scene registration
import { settings } from './settings.js';
import { Boot } from './scenes/boot.js';
import { Game } from './scenes/game.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: settings.canvas.width,
  height: settings.canvas.height,
  backgroundColor: settings.canvas.background,
  // Round render positions to whole pixels so pointer-followed objects (paddles,
  // cursors) don't shimmer sub-pixel as they move.
  roundPixels: true,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: settings.physics.gravity },
      debug: false,
    },
  },
  scene: [Boot, Game],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // Multi-touch for in-canvas pointer input (the DOM joystick/buttons overlay
  // handles its own touches; this is for games that also tap the canvas).
  input: {
    activePointers: 3,
  },
};

// Let players type into DOM form fields overlaid on the game (high-score
// name entry, chat boxes) while it runs. Phaser registers its keys (WASD,
// Space, arrows) as "captured": its window-level listener preventDefault()s
// them wherever focus is, so a focused <input> would never receive those
// letters. Key events that target a form field stop here (document sits
// between the field and window on the bubble path, and the field's own
// handlers have already run), and gaining focus clears held-down keys so
// the game doesn't keep moving on a key it never sees released.
const isFormField = (el) =>
  el instanceof Element && (el.closest('input, textarea, select') !== null || el.isContentEditable);
for (const type of ['keydown', 'keyup']) {
  document.addEventListener(type, (e) => {
    if (isFormField(e.target)) e.stopPropagation();
  });
}
document.addEventListener('focusin', (e) => {
  if (isFormField(e.target)) {
    for (const scene of game.scene.getScenes(true)) scene.input?.keyboard?.resetKeys();
  }
});

// Exported, not just constructed: `gipity page eval` can reach the live instance
// with `(await import('./js/config.js')).game` — index.html loads this as a
// module, so the import resolves from the module cache and returns THIS game
// rather than booting a second one. That means you can drive and assert on real
// game state headlessly without attaching a debug handle to `window`.
export const game = new Phaser.Game(config);

// Deterministic time-stepping for headless verification. In `gipity page eval`
// the browser can paint at ~15 fps, so waiting wall-clock time (setTimeout)
// advances the game far less than it looks and assertions report false
// negatives. advance() pauses the browser-driven loop and ticks Phaser's own
// TimeStep by hand - N simulated seconds run in milliseconds of real time,
// physics and timers included, at a fixed dt on any machine:
//
//   const { game, advance } = await import('./js/config.js');
//   advance(3);   // exactly 3s of game time, deterministic
export function advance(seconds, { fps = 60 } = {}) {
  const loop = game.loop;
  const dt = 1000 / fps;
  const steps = Math.max(1, Math.round(seconds * fps));
  const wasRunning = loop.running;
  if (wasRunning) loop.stop(); // stop RAF so our ticks are the only ones
  let now = loop.now;
  for (let i = 0; i < steps; i++) {
    now += dt;
    loop.step(now);
  }
  if (wasRunning) loop.start(game.step.bind(game)); // hand the clock back to RAF
  return steps;
}
