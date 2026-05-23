// Voxel shape generators - return arrays of [x, y, z] block offsets
// Import: import { solidCube, voxelSphere, ... } from './shapes.js';

export function solidCube(n) {
  const blocks = [];
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++)
    blocks.push([x, y, z]);
  return blocks;
}

export function voxelSphere(r) {
  const blocks = [];
  const c = r - 0.5;
  for (let x = 0; x < r * 2; x++) for (let y = 0; y < r * 2; y++) for (let z = 0; z < r * 2; z++) {
    const dx = x - c, dy = y - c, dz = z - c;
    if (dx * dx + dy * dy + dz * dz <= r * r) blocks.push([x, y, z]);
  }
  return blocks;
}

export function flatPanel(w, h) {
  const blocks = [];
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) blocks.push([x, y, 0]);
  return blocks;
}

export function hollowBox(n) {
  const blocks = [];
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) {
    if (x === 0 || x === n - 1 || y === 0 || y === n - 1 || z === 0 || z === n - 1)
      blocks.push([x, y, z]);
  }
  return blocks;
}

export function pyramid(base) {
  const blocks = [];
  for (let layer = 0; layer < base; layer++) {
    const s = base - layer;
    const off = layer;
    for (let x = 0; x < s; x++) for (let z = 0; z < s; z++)
      blocks.push([x + off, layer, z + off]);
  }
  return blocks;
}

export function cross(arm, thickness) {
  const blocks = [];
  const t = thickness, half = Math.floor((arm - t) / 2);
  for (let x = 0; x < arm; x++) for (let y = 0; y < arm; y++) for (let z = 0; z < t; z++) {
    const inH = x >= half && x < half + t;
    const inV = y >= half && y < half + t;
    if (inH || inV) blocks.push([x, y, z]);
  }
  return blocks;
}

export function tower(w, h) {
  const blocks = [];
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) for (let z = 0; z < w; z++)
    blocks.push([x, y, z]);
  return blocks;
}

export function lShape(size) {
  const blocks = [];
  for (let y = 0; y < size; y++) blocks.push([0, y, 0]);
  for (let x = 1; x < size; x++) blocks.push([x, 0, 0]);
  return blocks;
}

export function arch(w, h) {
  const blocks = [];
  for (let y = 0; y < h; y++) { blocks.push([0, y, 0]); blocks.push([w - 1, y, 0]); }
  for (let x = 1; x < w - 1; x++) blocks.push([x, h - 1, 0]);
  return blocks;
}
