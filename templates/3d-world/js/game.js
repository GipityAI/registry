// Game logic - orchestrates init and update loop
// World scale: 1 voxel = 1 world unit. Standard block = 3x3x3. Player = 5u tall.
import { setConfig, onInit, onUpdate, physics, player, primitives, ui, features } from './core.js';
import { config } from './config.js';
import { settings } from './settings.js';
import { buildDemoScene } from './scene.js';

setConfig(config);

onInit(async () => {
  player.initPlayer({
    ...settings.player,
    color: settings.colors.player,
    camera: settings.camera,
    aim: settings.aim,
    crosshair: settings.controls.crosshair,
  });

  primitives.workspace.snapEnabled = false;

  buildDemoScene();

  ui.showMessage('{{JS_TITLE}}', settings.gameplay.messageDuration);
});

// --- Audio ---
const rocketSound = new Audio(new URL('../sounds/rocket-launch-trimmed.mp3', import.meta.url).href);
rocketSound.volume = 0.8;

const explosionSound = new Audio(new URL('../sounds/explosion-quick.ogg', import.meta.url).href);
explosionSound.volume = 1.0;

const tickSound = new Audio(new URL('../sounds/block-collision-tick.mp3', import.meta.url).href);
tickSound.volume = 0.5;

const prevSpeeds = new Map();
let tickCooldown = 0;
const TICK_COOLDOWN = 0.04;
const IMPACT_THRESHOLD = 4.0;

let rocketAudioWired = false;

onUpdate((dt) => {
  // Wire rocket launcher audio hooks (features init after onInit)
  if (!rocketAudioWired) {
    const rl = features.get('rocket-launcher');
    if (rl) {
      rl.onFire(() => {
        const s = rocketSound.cloneNode();
        s.volume = 0.8;
        s.play().catch(() => {});
      });
      rl.onExplode(() => {
        const s = explosionSound.cloneNode();
        s.volume = 1.0;
        s.play().catch(() => {});
      });
      rocketAudioWired = true;
    }
  }

  // Block collision tick - detect speed drops on physics bodies
  tickCooldown = Math.max(0, tickCooldown - dt);

  if (physics.world) {
    physics.world.forEachActiveRigidBody((body) => {
      if (!body.isDynamic()) return;
      const handle = body.handle;
      const vel = body.linvel();
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
      const prev = prevSpeeds.get(handle);

      if (prev !== undefined && tickCooldown <= 0) {
        const drop = prev - speed;
        if (drop > IMPACT_THRESHOLD && speed < prev * 0.5) {
          const s = tickSound.cloneNode();
          s.volume = Math.min(1.0, (drop / 20) * 0.7 + 0.2);
          s.play().catch(() => {});
          tickCooldown = TICK_COOLDOWN;
        }
      }

      prevSpeeds.set(handle, speed);
    });
  }
});
