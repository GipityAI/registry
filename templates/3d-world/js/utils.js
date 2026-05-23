// Utility helpers - general-purpose functions for game code
// Import: import { randInt, onCircle, placeVoxels } from './utils.js';

import { primitives } from './core.js';

/** Random integer between min and max (inclusive) */
export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random point on a circle of radius r at y=0 */
export function onCircle(r) {
  const a = Math.random() * Math.PI * 2;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

/** Random float between min and max */
export function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

/** Place a group of 1x1x1 voxel blocks from [x,y,z] offset arrays */
export function placeVoxels(offsets, origin, color) {
  for (const [bx, by, bz] of offsets) {
    primitives.createPart({
      position: { x: origin.x + bx, y: origin.y + by, z: origin.z + bz },
      size: { x: 1, y: 1, z: 1 },
      color,
    });
  }
}
