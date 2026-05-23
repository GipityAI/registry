// Demo scene - replace this with your own world setup
// This file builds the starter scene with voxel structures.
// Safe to delete or gut once you start building your game.

import { primitives } from './core.js';
import { settings } from './settings.js';
import { randInt, randFloat, placeVoxels } from './utils.js';
import { solidCube, voxelSphere, flatPanel, hollowBox, pyramid, cross, tower, lShape, arch } from './shapes.js';

const palette = [0x4CAF50, 0x2196F3, 0xFF9800, 0x9C27B0, 0x00BCD4,
                 0xE91E63, 0x3F51B5, 0x009688, 0xFFC107, 0x795548];

const structureTypes = [
  () => solidCube(randInt(2, 4)),
  () => voxelSphere(randInt(2, 4)),
  () => flatPanel(randInt(3, 6), randInt(3, 6)),
  () => hollowBox(randInt(3, 5)),
  () => pyramid(randInt(3, 5)),
  () => cross(randInt(5, 7), 1),
  () => tower(2, randInt(5, 10)),
  () => lShape(randInt(4, 7)),
  () => arch(randInt(4, 6), randInt(4, 7)),
  () => solidCube(randInt(1, 3)),
];

/** Build the demo scene - compound blocks and voxel structures in two rings */
export function buildDemoScene() {
  // Create ground
  const { groundSize } = settings.world;
  primitives.createPart({
    position: { x: 0, y: -0.5, z: 0 },
    size: { x: groundSize, y: 1, z: groundSize },
    color: settings.colors.ground,
    anchored: true,
    material: 'concrete',
  });

  // Spawn points - a ring in the clear central zone (inside the structure
  // rings). getSpawnPosition() picks one at random + jitter so players don't
  // stack. More points = less crowding when many players join at once.
  const SPAWN_COUNT = 8;
  for (let i = 0; i < SPAWN_COUNT; i++) {
    const a = (i / SPAWN_COUNT) * Math.PI * 2;
    primitives.createSpawnPoint({
      position: { x: Math.cos(a) * 10, y: 3, z: Math.sin(a) * 10 },
    });
  }

  // Two rings of props - 5 compound blocks + 10 structures each.
  buildRing(18, 5, 10);
  buildRing(27, 5, 10);
}

/**
 * Place compound blocks + voxel structures around a circle at EVENLY-spaced
 * angles (not random). Random placement let props spawn overlapping, and
 * interpenetrating bodies make the physics solver shove them apart
 * explosively on the first frame. Even spacing + a little radius jitter keeps
 * neighbours clear of each other.
 */
function buildRing(radius, compoundCount, structureCount) {
  const slots = compoundCount + structureCount;
  // Spread the compound (red) blocks evenly through the slots.
  const compoundEvery = Math.round(slots / compoundCount);
  let compoundsLeft = compoundCount;
  for (let i = 0; i < slots; i++) {
    const angle = (i / slots) * Math.PI * 2 + randFloat(-0.06, 0.06);
    const r = radius + randFloat(-2, 2);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (compoundsLeft > 0 && i % compoundEvery === 0) {
      compoundsLeft--;
      primitives.createCompoundBlock({
        position: { x, y: 1.5, z },
        color: 0xCC2222,
        breakForce: 6,
      });
    } else {
      const t = randInt(0, structureTypes.length - 1);
      placeVoxels(structureTypes[t](), { x, y: 0.5, z }, palette[t]);
    }
  }
}
