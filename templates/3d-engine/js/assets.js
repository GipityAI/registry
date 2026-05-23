/**
 * 3D World - Asset Loader
 * Loads models, sounds, and textures from the shared CDN.
 *
 * Exports: initAssets(), loadModel, loadSound, playSound, getTexture, preload
 */
import { scene, THREE } from './world.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ASSET_BASE = 'https://assets.gipity.ai/games/v1';
let manifest = null;
const modelCache = new Map();
const textureCache = new Map();
const textureLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();

// Audio via Howler.js (loaded globally from CDN in index.html - fallback to Web Audio)
const audioCache = new Map();

/** Initialize assets - load manifest from CDN if available */
async function initAssets(onProgress) {
  // TODO: Enable manifest fetch when asset CDN (assets.gipity.ai) is live
  // For now, use built-in helpers (createVoxelBox, createVoxelGround, THREE.js geometry)
  manifest = { models: {}, sounds: {}, textures: {} };
  if (onProgress) onProgress(0.1, 'Assets ready');
}

/** Preload a list of asset names. Calls onProgress(percent, label) as items load. */
async function preload(assetNames, onProgress) {
  const total = assetNames.length;
  let loaded = 0;

  const promises = assetNames.map(async (name) => {
    try {
      if (manifest.models?.[name]) {
        await loadModel(name);
      } else if (manifest.textures?.[name]) {
        await getTexture(name);
      }
      // Sounds are lazy-loaded on first play
    } catch (err) {
      console.warn(`Failed to preload "${name}":`, err);
    }
    loaded++;
    if (onProgress) onProgress(loaded / total, `Loading ${name}...`);
  });

  await Promise.all(promises);
}

/** Load a 3D model by name. Returns a Three.js Group (cloned from cache). */
async function loadModel(name) {
  if (modelCache.has(name)) {
    return modelCache.get(name).clone();
  }

  const entry = manifest.models?.[name];
  const url = entry?.url || `${ASSET_BASE}/models/${name}.glb`;

  return new Promise((resolve, reject) => {
    gltfLoader.load(
      url,
      (gltf) => {
        const model = gltf.scene;
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material) child.material.shadowSide = THREE.BackSide;
          }
        });
        modelCache.set(name, model);
        resolve(model.clone());
      },
      undefined,
      (err) => reject(new Error(`Model "${name}" failed: ${err.message}`)),
    );
  });
}

/** Spawn a model into the scene at a position. Returns the model. */
async function spawn(name, position = { x: 0, y: 0, z: 0 }, scale = 1) {
  const model = await loadModel(name);
  model.position.set(position.x, position.y, position.z);
  if (typeof scale === 'number') {
    model.scale.setScalar(scale);
  } else {
    model.scale.set(scale.x, scale.y, scale.z);
  }
  scene.add(model);
  return model;
}

/** Remove a model from the scene */
function despawn(model) {
  scene.remove(model);
}

/** Load a texture by name. Returns a Three.js Texture. */
async function getTexture(name) {
  if (textureCache.has(name)) return textureCache.get(name);

  const entry = manifest.textures?.[name];
  const url = entry?.url || `${ASSET_BASE}/textures/${name}.png`;

  return new Promise((resolve, reject) => {
    textureLoader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.NearestFilter; // Crisp voxel look
        tex.minFilter = THREE.NearestMipmapLinearFilter;
        textureCache.set(name, tex);
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

/** Play a sound by name. Uses Howler.js if available, else Web Audio. */
function playSound(name, options = {}) {
  const entry = manifest.sounds?.[name];
  const url = entry?.url || `${ASSET_BASE}/sounds/${name}.ogg`;

  if (typeof Howl !== 'undefined') {
    if (!audioCache.has(name)) {
      audioCache.set(name, new Howl({ src: [url], volume: options.volume ?? 1.0 }));
    }
    const howl = audioCache.get(name);
    howl.volume(options.volume ?? 1.0);
    howl.play();
    return howl;
  }

  // Fallback: basic Web Audio
  const audio = new Audio(url);
  audio.volume = options.volume ?? 1.0;
  audio.play().catch(() => {});
  return audio;
}

/** Load a sound into cache (for preloading) */
function loadSound(name) {
  const entry = manifest.sounds?.[name];
  const url = entry?.url || `${ASSET_BASE}/sounds/${name}.ogg`;
  if (typeof Howl !== 'undefined' && !audioCache.has(name)) {
    audioCache.set(name, new Howl({ src: [url], preload: true }));
  }
}

/** Create a simple colored voxel box (no model needed) */
function createVoxelBox(color = 0x4CAF50, size = 1) {
  const geo = new THREE.BoxGeometry(size, size, size);
  const mat = new THREE.MeshLambertMaterial({ color, shadowSide: THREE.BackSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Create a grid of voxel blocks (simple flat terrain) */
function createVoxelGround(width = 20, depth = 20, color = 0x4CAF50, y = 0) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshLambertMaterial({ color, shadowSide: THREE.BackSide });

  // Use instanced mesh for performance
  const count = width * depth;
  const instancedMesh = new THREE.InstancedMesh(geo, mat, count);
  instancedMesh.receiveShadow = true;
  instancedMesh.castShadow = false;

  const matrix = new THREE.Matrix4();
  let i = 0;
  for (let x = -Math.floor(width / 2); x < Math.ceil(width / 2); x++) {
    for (let z = -Math.floor(depth / 2); z < Math.ceil(depth / 2); z++) {
      matrix.setPosition(x, y - 0.5, z);
      instancedMesh.setMatrixAt(i++, matrix);
    }
  }
  instancedMesh.instanceMatrix.needsUpdate = true;

  group.add(instancedMesh);
  return group;
}

// --- Sub-Voxel Shape System (v13+) ---

/**
 * Predefined 3x3x3 sub-voxel shapes as 27-bit bitmasks.
 * Bit index = z*9 + y*3 + x where x,y,z are 0-2.
 * Each sub-voxel is 1/3 of the block size.
 */
const SHAPES = {
  FULL:    0x7FFFFFF,  // all 27 bits - solid cube
  SLAB:    0b000000000_000000000_111111111,  // bottom layer (y=0)
  HALF:    0b011011011_011011011_011011011,  // right half (x=1,2)
  STAIR:   0b000000000_011011011_111111111,  // bottom full + middle right half
  SLOPE:   0b001001001_011011011_111111111,  // bottom full, middle 2/3, top 1/3
  CORNER:  0b000000000_000000011_000011011,  // bottom-right corner
  PILLAR:  0b000010000_000010000_000010000,  // center column only
  ARCH:    0b111010111_111000111_111111111,  // full with center-top opening
};

const geometryCache = new Map();
const materialCache = new Map();

/** Material presets - visual + physics defaults */
const MATERIAL_PRESETS = {
  plastic:  { friction: 0.5,  elasticity: 0.3,  type: 'lambert', shininess: 0 },
  metal:    { friction: 0.4,  elasticity: 0.2,  type: 'phong',   shininess: 60 },
  wood:     { friction: 0.6,  elasticity: 0.2,  type: 'lambert', shininess: 0, tint: 0.05 },
  glass:    { friction: 0.2,  elasticity: 0.1,  type: 'phong',   shininess: 90, defaultTransparency: 0.6 },
  neon:     { friction: 0.3,  elasticity: 0.2,  type: 'basic',   emissive: true },
  ice:      { friction: 0.05, elasticity: 0.1,  type: 'phong',   shininess: 100 },
  grass:    { friction: 0.7,  elasticity: 0.1,  type: 'lambert', shininess: 0 },
  sand:     { friction: 0.8,  elasticity: 0.05, type: 'lambert', shininess: 0 },
};

/**
 * Build a BufferGeometry from a 27-bit sub-voxel bitmask.
 * Each sub-voxel is (size/3) cubes. Only exposed faces are emitted.
 */
function buildSubVoxelGeometry(shapeBitmask, size = { x: 1, y: 1, z: 1 }) {
  const cacheKey = `${shapeBitmask}-${size.x}-${size.y}-${size.z}`;
  if (geometryCache.has(cacheKey)) return geometryCache.get(cacheKey).clone();

  // Fast path: full cube
  if (shapeBitmask === SHAPES.FULL) {
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    geometryCache.set(cacheKey, geo);
    return geo.clone();
  }

  // Check if bit is set for sub-voxel at (x, y, z)
  const has = (x, y, z) => {
    if (x < 0 || x > 2 || y < 0 || y > 2 || z < 0 || z > 2) return false;
    return (shapeBitmask >> (z * 9 + y * 3 + x)) & 1;
  };

  const positions = [];
  const normals = [];
  const indices = [];
  const sx = size.x / 3, sy = size.y / 3, sz = size.z / 3;
  const ox = -size.x / 2, oy = -size.y / 2, oz = -size.z / 2;

  // Face definitions: [axis, dir, normal, vertex offsets]
  const faces = [
    { axis: 0, dir:  1, nx:  1, ny: 0, nz: 0 }, // +X
    { axis: 0, dir: -1, nx: -1, ny: 0, nz: 0 }, // -X
    { axis: 1, dir:  1, nx: 0, ny:  1, nz: 0 }, // +Y
    { axis: 1, dir: -1, nx: 0, ny: -1, nz: 0 }, // -Y
    { axis: 2, dir:  1, nx: 0, ny: 0, nz:  1 }, // +Z
    { axis: 2, dir: -1, nx: 0, ny: 0, nz: -1 }, // -Z
  ];

  for (let z = 0; z < 3; z++) {
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        if (!has(x, y, z)) continue;

        const bx = ox + x * sx, by = oy + y * sy, bz = oz + z * sz;

        for (const f of faces) {
          // Check if neighbor in this direction exists
          const nx = x + (f.axis === 0 ? f.dir : 0);
          const ny = y + (f.axis === 1 ? f.dir : 0);
          const nz = z + (f.axis === 2 ? f.dir : 0);
          if (has(nx, ny, nz)) continue; // face is hidden

          const vi = positions.length / 3;

          // Emit quad vertices
          if (f.axis === 0) { // X face
            const fx = f.dir > 0 ? bx + sx : bx;
            positions.push(fx, by, bz,  fx, by + sy, bz,  fx, by + sy, bz + sz,  fx, by, bz + sz);
          } else if (f.axis === 1) { // Y face
            const fy = f.dir > 0 ? by + sy : by;
            positions.push(bx, fy, bz,  bx + sx, fy, bz,  bx + sx, fy, bz + sz,  bx, fy, bz + sz);
          } else { // Z face
            const fz = f.dir > 0 ? bz + sz : bz;
            positions.push(bx, by, fz,  bx + sx, by, fz,  bx + sx, by + sy, fz,  bx, by + sy, fz);
          }

          for (let i = 0; i < 4; i++) normals.push(f.nx, f.ny, f.nz);

          // Two triangles per quad (wind correctly based on normal direction)
          if (f.dir > 0) {
            indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
          } else {
            indices.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
          }
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  geometryCache.set(cacheKey, geo);
  return geo.clone();
}

/**
 * Get vertex positions for a sub-voxel shape (used for convex hull colliders).
 * Returns Float32Array of [x,y,z, x,y,z, ...] for all active sub-voxel corners.
 */
function getSubVoxelHullPoints(shapeBitmask, size = { x: 1, y: 1, z: 1 }) {
  if (shapeBitmask === SHAPES.FULL) return null; // use cuboid instead

  const sx = size.x / 3, sy = size.y / 3, sz = size.z / 3;
  const ox = -size.x / 2, oy = -size.y / 2, oz = -size.z / 2;
  const pointSet = new Set();

  for (let z = 0; z < 3; z++) {
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        if (!((shapeBitmask >> (z * 9 + y * 3 + x)) & 1)) continue;
        const bx = ox + x * sx, by = oy + y * sy, bz = oz + z * sz;
        // Add all 8 corners of this sub-voxel
        for (let cz = 0; cz <= 1; cz++) {
          for (let cy = 0; cy <= 1; cy++) {
            for (let cx = 0; cx <= 1; cx++) {
              const key = `${(bx + cx * sx).toFixed(4)},${(by + cy * sy).toFixed(4)},${(bz + cz * sz).toFixed(4)}`;
              pointSet.add(key);
            }
          }
        }
      }
    }
  }

  const points = new Float32Array(pointSet.size * 3);
  let i = 0;
  for (const key of pointSet) {
    const [px, py, pz] = key.split(',').map(Number);
    points[i++] = px;
    points[i++] = py;
    points[i++] = pz;
  }
  return points;
}

/**
 * Create a Three.js material for a Part based on material preset.
 * Results are cached by color + materialName + transparency.
 */
function createPartMaterial(color = 0x888888, materialName = 'plastic', transparency = 0) {
  const cacheKey = `${color}-${materialName}-${transparency}`;
  if (materialCache.has(cacheKey)) return materialCache.get(cacheKey);

  const preset = MATERIAL_PRESETS[materialName] || MATERIAL_PRESETS.plastic;
  const effectiveTransparency = transparency || preset.defaultTransparency || 0;
  const transparent = effectiveTransparency > 0;
  const opacity = 1 - effectiveTransparency;

  // shadowSide: BackSide renders shadows from back faces, eliminating Peter Panning
  // (the gap between objects and their shadows) without needing shadow bias.
  let mat;
  if (preset.type === 'basic') {
    // Neon / emissive
    mat = new THREE.MeshBasicMaterial({ color, transparent, opacity, shadowSide: THREE.BackSide });
  } else if (preset.type === 'phong') {
    // Metal, glass, ice - shiny
    mat = new THREE.MeshPhongMaterial({
      color,
      shininess: preset.shininess || 30,
      transparent,
      opacity,
      shadowSide: THREE.BackSide,
    });
  } else {
    // Plastic, wood, grass, sand - matte
    mat = new THREE.MeshLambertMaterial({ color, transparent, opacity, shadowSide: THREE.BackSide });
  }

  materialCache.set(cacheKey, mat);
  return mat;
}

export {
  initAssets,
  preload,
  loadModel,
  spawn,
  despawn,
  getTexture,
  playSound,
  loadSound,
  createVoxelBox,
  createVoxelGround,
  // v13+ World Primitives API
  SHAPES,
  MATERIAL_PRESETS,
  buildSubVoxelGeometry,
  getSubVoxelHullPoints,
  createPartMaterial,
};
