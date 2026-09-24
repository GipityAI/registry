// Game settings - tunable values for gameplay, physics, and visuals
// Import: import { settings } from './settings.js';

export const settings = {
  // Colors
  colors: {
    player: 0xf26522,
    ground: 0x4CAF50,
    objects: 0x2196F3,
  },

  // World (1 voxel = 1 world unit, standard block = 3x3x3)
  world: {
    groundSize: 90,
    fogDistance: 150,
  },

  // Player (5u tall, 4u arm span)
  player: {
    speed: 12,
    jumpForce: 18,
    gravity: -40,
  },

  // Camera (Roblox/Fortnite-style: right-drag to orbit, scroll to zoom)
  camera: {
    distance: 20,       // default orbit distance
    minDistance: 2,      // scroll all the way in = first-person
    maxDistance: 60,     // scroll out limit
    heightOffset: 6,    // look target above player center
    sensitivity: 0.003, // mouse look speed
    scrollSpeed: 3,     // zoom speed
  },

  // Aim mode (hold right-click: Fortnite over-the-shoulder)
  aim: {
    distance: 8,          // tight zoom when aiming
    shoulderOffset: 2,    // camera offset to the right
    moveMultiplier: 0.5,  // slower movement when aiming
    holdMs: 150,          // right-click hold threshold for aim vs orbit
  },

  // Controls
  controls: {
    crosshair: true,
  },

  // Gameplay
  gameplay: {
    spawnRange: 40,
    messageDuration: 3000,
  },
};
