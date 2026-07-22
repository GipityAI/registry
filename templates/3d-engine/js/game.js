// Game entry - wire your logic here.
//
// onInit runs once after the engine boots. onUpdate runs every frame.
// Out of the box this is a walkable 3D space: a controllable character on a
// ground plane (WASD/arrows to move, space to jump, mouse to look, scroll to
// zoom, E / left-click for action). Replace buildScene() with your own world
// and add your logic in onUpdate below.

// `player` and `primitives` are imported ready to use - core.js re-exports
// every engine module (world, physics, assets, ui, network, THREE, ...).
import { setConfig, onInit, onUpdate, player, primitives } from './core.js';
import { config } from './config.js';
import { buildScene } from './scene.js';

setConfig(config);

onInit(async () => {
  buildScene();
  // The controllable character. Every option has a sane default - pass e.g.
  // { speed, jumpForce, color, camera: { mode: 'firstPerson', distance } } to tune it.
  player.initPlayer();
});

onUpdate((dt) => {
  // Per-frame logic goes here.
  //
  // The crosshair ray is the entry point for almost every interaction. It
  // hands back the Part it hit (null for ground/scenery), so you never map a
  // collider back to a Part yourself:
  //
  //   const hit = player.aimRaycast(10);   // reach, measured from the player
  //   if (player.getHeldPart()) player.release({ throwSpeed: 40 });  // hurl it
  //   else if (hit && !player.grab(hit.part))    // grab() is false for scenery
  //     primitives.createPart({ position: hit.point, size: { x: 3, y: 3, z: 3 } });
  //
  // Parts are dynamic by default, so stacks topple and piles scatter for free.
  // Read input from player.inputState ({ action, jump, mouseDown, ... }).
});
