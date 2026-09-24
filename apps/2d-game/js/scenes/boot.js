// Boot scene - preloader with progress bar
import { settings } from '../settings.js';

export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    const { width, height } = settings.canvas;

    // Progress bar
    const barW = width * 0.4;
    const barH = 8;
    const barX = (width - barW) / 2;
    const barY = height / 2;

    const bg = this.add.rectangle(width / 2, barY, barW, barH, 0x333333).setOrigin(0.5);
    const fill = this.add.rectangle(barX, barY - barH / 2, 0, barH, settings.colors.player).setOrigin(0, 0);
    const text = this.add.text(width / 2, barY - 30, 'Loading...', {
      fontSize: '16px',
      color: settings.colors.text,
    }).setOrigin(0.5);

    this.load.on('progress', (value) => {
      fill.width = barW * value;
    });

    this.load.on('complete', () => {
      bg.destroy();
      fill.destroy();
      text.destroy();
    });

    // Add asset loading here:
    // this.load.image('player', './images/player.png');
    // this.load.spritesheet('hero', './images/hero.png', { frameWidth: 32, frameHeight: 48 });
  }

  create() {
    this.scene.start('Game');
  }
}
