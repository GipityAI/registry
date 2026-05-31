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
};

new Phaser.Game(config);
