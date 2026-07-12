// Main game scene - gameplay logic
import { settings } from '../settings.js';
import { touch, initTouchControls } from '../controls.js';

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

    // Input: arrows + WASD on desktop; on touch devices controls.js overlays
    // a virtual joystick (left) + Jump button (right) that feed `touch`.
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,SPACE');
    initTouchControls({ buttons: [{ id: 'jump', label: 'Jump' }] });

    // Title text
    this.add.text(width / 2, 30, '{{JS_TITLE}}', {
      fontSize: '28px',
      color: settings.colors.text,
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // Instructions (per input device)
    const hint = touch.enabled
      ? 'Joystick to move, button to jump'
      : 'WASD/arrows to move, Space to jump';
    this.add.text(width / 2, 65, hint, {
      fontSize: '14px',
      color: '#aaaaaa',
    }).setOrigin(0.5);
  }

  update() {
    const { speed, jumpForce } = settings.player;
    const body = this.player.body;

    // Horizontal movement: keyboard is digital, joystick is analog (-1..1)
    const keyX = (this.cursors.right.isDown || this.keys.D.isDown ? 1 : 0)
               - (this.cursors.left.isDown || this.keys.A.isDown ? 1 : 0);
    const moveX = keyX !== 0 ? keyX : touch.x;
    body.setVelocityX(moveX * speed);

    // Jump (up/W/Space or the touch Jump button)
    const jumpPressed = this.cursors.up.isDown || this.keys.W.isDown
      || this.keys.SPACE.isDown || touch.isDown('jump');
    if (jumpPressed && body.touching.down) {
      body.setVelocityY(jumpForce);
    }
  }
}
