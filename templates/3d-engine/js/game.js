// Game entry - wire your logic here.
//
// onInit runs once after the engine boots. onUpdate runs every frame.
// The starter scene is a single ground plane; replace buildScene() with
// your own world. Add a controllable character, features, or UI as needed -
// see the 3d-engine skill doc for the engine API reference.

import { setConfig, onInit, onUpdate } from './core.js';
import { config } from './config.js';
import { buildScene } from './scene.js';

setConfig(config);

onInit(async () => {
  buildScene();
});

onUpdate((dt) => {
  // Per-frame logic goes here.
});
