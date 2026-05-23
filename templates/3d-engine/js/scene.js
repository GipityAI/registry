// Scene setup - build your world here.
//
// The starter ground plane proves the engine is running. Replace it with
// your own scene: add structures with primitives.createPart, load meshes
// via assets.js, or procedurally build voxel shapes using shapes.js.

import { primitives } from './core.js';
import { settings } from './settings.js';

/** Build the starter scene - one flat ground plane. */
export function buildScene() {
  const { groundSize } = settings.world;
  primitives.createPart({
    position: { x: 0, y: -0.5, z: 0 },
    size: { x: groundSize, y: 1, z: groundSize },
    color: settings.colors.ground,
    anchored: true,
    material: 'concrete',
  });
}
