// Main game scene - gameplay logic
import { settings } from '../settings.js';
import { t } from '../strings.js';

export class Game extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  create() {
    const { width, height } = settings.canvas;

    // Ground
    this.ground = this.add.rectangle(
      width / 2, height - settings.ground.height / 2,
      width, settings.ground.height,
      settings.colors.ground,
    );
    this.physics.add.existing(this.ground, true); // static body

    // Player
    this.player = this.add.rectangle(
      width / 2, height - settings.ground.height - settings.player.height,
      settings.player.width, settings.player.height,
      settings.colors.player,
    );
    this.physics.add.existing(this.player);
    this.player.body.setBounce(settings.player.bounce);
    this.player.body.setCollideWorldBounds(true);

    // Collisions
    this.physics.add.collider(this.player, this.ground);

    // Input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Title text
    this.add.text(width / 2, 30, t('title'), {
      fontSize: '28px',
      color: settings.colors.text,
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // Instructions
    this.add.text(width / 2, 65, t('welcome'), {
      fontSize: '14px',
      color: '#aaaaaa',
    }).setOrigin(0.5);
  }

  update() {
    const { speed, jumpForce } = settings.player;
    const body = this.player.body;

    // Horizontal movement
    if (this.cursors.left.isDown) {
      body.setVelocityX(-speed);
    } else if (this.cursors.right.isDown) {
      body.setVelocityX(speed);
    } else {
      body.setVelocityX(0);
    }

    // Jump (arrow up or space)
    const jumpPressed = this.cursors.up.isDown || this.spaceKey.isDown;
    if (jumpPressed && body.touching.down) {
      body.setVelocityY(jumpForce);
    }
  }
}
