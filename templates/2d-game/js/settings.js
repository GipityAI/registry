// Game settings - tunable values for gameplay, physics, and visuals
// Import: import { settings } from './settings.js';

export const settings = {
  // Canvas
  canvas: {
    width: 800,
    height: 600,
    background: '#1a1a2e',
  },

  // Colors (CSS hex strings for Phaser)
  colors: {
    player: 0xf26522,
    ground: 0x4CAF50,
    objects: 0x2196F3,
    text: '#ffffff',
  },

  // Physics
  physics: {
    gravity: 800,
  },

  // Player
  player: {
    width: 32,
    height: 48,
    speed: 300,
    jumpForce: -450,
    bounce: 0.1,
  },

  // Ground
  ground: {
    height: 40,
  },

  // Gameplay
  gameplay: {
    messageDuration: 3000,
  },
};
