/**
 * 3D World - World Primitives Module
 * Part system, Workspace, and snap mechanics.
 *
 * This is 3D World's equivalent of Roblox's Workspace + BasePart system.
 * Every Part has physics properties, appearance, and a 3x3x3 sub-voxel shape.
 * Parts are dynamic (gravity-affected) by default. Set anchored=true to fix in place.
 *
 * Exports: workspace, createPart, removePart, setProperty, getPart, getParts,
 *          queryParts, detachPart, createSpawnPoint, SHAPES, updateParts
 */
import { scene, THREE } from './world.js';
import * as physics from './physics.js';
import * as constraintsModule from './constraints.js';
import {
  SHAPES, MATERIAL_PRESETS, buildSubVoxelGeometry,
  getSubVoxelHullPoints, createPartMaterial,
} from './assets.js';

// --- Part ID generation ---
let nextPartId = 1;
const PART_CHARS = '23456789abcdefghjkmnpqrstuvwxyz'; // unambiguous
function generatePartId() {
  let id = 'part-';
  for (let i = 0; i < 8; i++) id += PART_CHARS[Math.floor(Math.random() * PART_CHARS.length)];
  return id;
}

// --- Default Part properties ---
const PART_DEFAULTS = {
  name: '',
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  size: { x: 1, y: 1, z: 1 },
  anchored: false,
  canCollide: true,
  mass: null, // null = auto (size-derived at density 1). A number = TOTAL mass in kg.
  friction: 0.5,
  elasticity: 0.3,
  linearDamping: 0.1,
  angularDamping: 0.5,
  color: 0x888888,
  material: 'plastic',
  transparency: 0.0,
  castShadow: true,
  receiveShadow: true,
  shape: SHAPES.FULL,
};

// --- Workspace singleton ---
const workspace = {
  parts: new Map(),
  spawnPoints: [],
  // World gravity, live: assigning it (or mutating .y) changes the physics
  // world immediately and wakes sleeping bodies. Default { x: 0, y: -40, z: 0 }.
  get gravity() { return physics.getGravity(); },
  set gravity(g) { physics.setGravity(g); },
  // Auto-weld is OPT-IN: when true, aligned dynamic Parts that touch are fused
  // into one rigid body (Roblox-style snap-together building). Leave false for
  // free-standing physics - stacks that can topple, piles that scatter.
  snapEnabled: false,
  snapDistance: 0.15,
  snapAngle: Math.PI / 12, // 15 degrees

  // Lighting reference (populated by world.js in v13+)
  lighting: null,

  // Event listeners
  _snapListeners: [],
  onSnap(callback) { workspace._snapListeners.push(callback); },
};

// --- Snap system state ---
let snapFrameCounter = 0;
const SNAP_INTERVAL = 5; // run every N frames (~80ms at 60fps)
const snappedPairs = new Set(); // "idA-idB" strings to avoid re-snapping
let snapLogged = false; // one-time console note the first time auto-weld fires

/**
 * Create a Part - the universal 3D primitive.
 * Parts are dynamic (gravity-affected) by default. Set anchored: true for static.
 *
 * @param {Object} props - Part properties (see PART_DEFAULTS for all options)
 * @returns {Object} Part object with all properties + internal refs (_body, _collider, _mesh)
 */
function createPart(props = {}) {
  // Merge with defaults, apply material preset overrides
  const part = { ...PART_DEFAULTS };
  const materialName = props.material || part.material;
  const preset = MATERIAL_PRESETS[materialName];
  if (preset) {
    part.friction = preset.friction;
    part.elasticity = preset.elasticity;
  } else if (materialName) {
    console.warn(`[engine] Unknown material "${materialName}" - falling back to plastic. Valid: ${Object.keys(MATERIAL_PRESETS).join(', ')}`);
  }
  Object.assign(part, props);

  // ID: adopt an explicit id when one is given - a host world-state sync
  // passes the host's id so its delta/keyframe rows match this client's
  // parts - otherwise generate a fresh one.
  part.id = props.id || generatePartId();

  // Copy nested objects to avoid shared references
  part.position = { ...PART_DEFAULTS.position, ...props.position };
  part.rotation = { ...PART_DEFAULTS.rotation, ...props.rotation };
  part.size = { ...PART_DEFAULTS.size, ...props.size };

  // Build Three.js mesh
  const geometry = buildSubVoxelGeometry(part.shape, part.size);
  const mat = createPartMaterial(part.color, part.material, part.transparency);
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(part.position.x, part.position.y, part.position.z);
  mesh.quaternion.set(part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w);
  mesh.castShadow = part.castShadow;
  mesh.receiveShadow = part.receiveShadow;
  scene.add(mesh);
  part._mesh = mesh;

  // Build Rapier physics body
  if (physics.rapier && physics.world) {
    const halfExtents = { x: part.size.x / 2, y: part.size.y / 2, z: part.size.z / 2 };
    const hullPoints = part.shape !== SHAPES.FULL ? getSubVoxelHullPoints(part.shape, part.size) : null;

    const result = physics.addBody(part.position, halfExtents, {
      type: part.anchored ? 'fixed' : 'dynamic',
      rotation: part.rotation,
      mass: part.mass,
      friction: part.friction,
      restitution: part.elasticity,
      linearDamping: part.linearDamping,
      angularDamping: part.angularDamping,
      isSensor: !part.canCollide,
      convexHullPoints: hullPoints,
    });
    part._body = result.body;
    part._collider = result.collider;

    // Tag the body with the part ID for lookups
    part._body._gip3dwPartId = part.id;
  }

  // Register
  workspace.parts.set(part.id, part);

  if (workspace.parts.size > 500 && workspace.parts.size % 100 === 1) {
    console.warn(`[Primitives] ${workspace.parts.size} parts in workspace. Consider using InstancedMesh for large counts.`);
  }

  return part;
}

/** Remove a part from the world, breaking all constraints. */
function removePart(partOrId) {
  const part = typeof partOrId === 'string' ? workspace.parts.get(partOrId) : partOrId;
  if (!part) return;

  // Remove all constraints on this part
  constraintsModule.removeAll(part);

  // Remove from scene
  if (part._mesh) {
    scene.remove(part._mesh);
    if (part._mesh.geometry) part._mesh.geometry.dispose();
  }

  // Remove physics body
  if (part._body) {
    physics.removeBody(part._body);
  }

  // Clear snap pairs involving this part
  for (const key of snappedPairs) {
    if (key.includes(part.id)) snappedPairs.delete(key);
  }

  // Drop the part from any compound block it belongs to. Without this, a
  // compound keeps a stale reference to a part whose physics body has been
  // freed (e.g. when a multiplayer world resync wipes and rebuilds parts) -
  // and a later breakAt() would call Rapier on the freed body and crash.
  releaseFromCompound(part);

  workspace.parts.delete(part.id);
}

/**
 * Update a Part property at runtime with proper side effects.
 * @param {Object} partOrId - Part object or part ID string
 * @param {string} key - Property name
 * @param {*} value - New value
 */
function setProperty(partOrId, key, value) {
  const part = typeof partOrId === 'string' ? workspace.parts.get(partOrId) : partOrId;
  if (!part) return;

  part[key] = value;

  switch (key) {
    case 'anchored':
      if (part._body) {
        physics.setBodyType(part._body, value ? 'fixed' : 'dynamic');
      }
      break;

    case 'canCollide':
      if (part._collider) {
        physics.setColliderProps(part._collider, { isSensor: !value });
      }
      break;

    case 'position':
      part.position = { ...value };
      if (part._mesh) part._mesh.position.set(value.x, value.y, value.z);
      if (part._body) part._body.setTranslation(value, true);
      break;

    case 'rotation':
      part.rotation = { ...value };
      if (part._mesh) part._mesh.quaternion.set(value.x, value.y, value.z, value.w);
      if (part._body) part._body.setRotation(value, true);
      break;

    case 'color':
    case 'material':
    case 'transparency': {
      const mat = createPartMaterial(part.color, part.material, part.transparency);
      if (part._mesh) part._mesh.material = mat;
      // Update physics properties from material preset
      if (key === 'material') {
        const preset = MATERIAL_PRESETS[value];
        if (preset) {
          part.friction = preset.friction;
          part.elasticity = preset.elasticity;
          if (part._collider) {
            physics.setColliderProps(part._collider, {
              friction: preset.friction,
              restitution: preset.elasticity,
            });
          }
        }
      }
      break;
    }

    case 'friction':
    case 'elasticity':
      if (part._collider) {
        physics.setColliderProps(part._collider, {
          friction: part.friction,
          restitution: part.elasticity,
        });
      }
      break;

    case 'size':
    case 'shape': {
      part[key] = key === 'size' ? { ...value } : value;
      // Rebuild geometry
      if (part._mesh) {
        const newGeo = buildSubVoxelGeometry(part.shape, part.size);
        part._mesh.geometry.dispose();
        part._mesh.geometry = newGeo;
      }
      // Rebuild collider (must remove old, create new)
      if (part._body && part._collider) {
        physics.world.removeCollider(part._collider, false);
        const halfExtents = { x: part.size.x / 2, y: part.size.y / 2, z: part.size.z / 2 };
        const hullPoints = part.shape !== SHAPES.FULL ? getSubVoxelHullPoints(part.shape, part.size) : null;

        let colliderDesc;
        if (hullPoints) {
          colliderDesc = physics.rapier.ColliderDesc.convexHull(hullPoints);
        }
        if (!colliderDesc) {
          colliderDesc = physics.rapier.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
        }
        colliderDesc.setFriction(part.friction);
        colliderDesc.setRestitution(part.elasticity);
        if (!part.canCollide) colliderDesc.setSensor(true);
        part._collider = physics.world.createCollider(colliderDesc, part._body);
      }
      break;
    }

    case 'castShadow':
      if (part._mesh) part._mesh.castShadow = value;
      break;

    case 'receiveShadow':
      if (part._mesh) part._mesh.receiveShadow = value;
      break;

    case 'mass':
      if (part._collider && !part.anchored) {
        part._collider.setMass(value); // TOTAL mass, matching physics.addBody
      }
      break;

    case 'linearDamping':
      if (part._body) part._body.setLinearDamping(value);
      break;

    case 'angularDamping':
      if (part._body) part._body.setAngularDamping(value);
      break;
  }
}

/** Get a part by ID */
function getPart(id) {
  return workspace.parts.get(id) || null;
}

/** Get all parts as an array */
function getParts() {
  return Array.from(workspace.parts.values());
}

/** Find parts matching a filter object. Example: queryParts({color: 0xff0000, anchored: true}) */
function queryParts(filter) {
  return getParts().filter(part => {
    for (const [key, value] of Object.entries(filter)) {
      if (part[key] !== value) return false;
    }
    return true;
  });
}

/** Break all constraints on a part (detach from everything) */
function detachPart(partOrId) {
  const part = typeof partOrId === 'string' ? workspace.parts.get(partOrId) : partOrId;
  if (!part) return;
  constraintsModule.removeAll(part);
  // Clear snap pairs
  for (const key of snappedPairs) {
    if (key.includes(part.id)) snappedPairs.delete(key);
  }
}

/**
 * Create a SpawnPoint - where players appear/respawn.
 * @param {Object} props
 * @param {Object} props.position - {x, y, z}
 * @param {number} props.teamColor - Optional team color for team-based spawning
 * @param {number} props.duration - Optional force-field duration in seconds after spawn
 * @returns {Object} SpawnPoint object
 */
function createSpawnPoint(props = {}) {
  const sp = {
    id: generatePartId().replace('part', 'spwn'),
    position: { x: 0, y: 1, z: 0, ...props.position },
    teamColor: props.teamColor || null,
    duration: props.duration || 0,
  };
  workspace.spawnPoints.push(sp);
  return sp;
}

/**
 * Pick a spawn position for a player: a random SpawnPoint (optionally
 * team-filtered) plus a small random jitter. The jitter means two players
 * choosing the same point never spawn at the identical transform - and since
 * players are dynamic physics bodies, any remaining overlap is resolved
 * immediately by collision. Add more SpawnPoints to reduce crowding.
 */
function getSpawnPosition(teamColor = null) {
  let points = workspace.spawnPoints;
  if (teamColor !== null) {
    const filtered = points.filter(sp => sp.teamColor === teamColor);
    if (filtered.length) points = filtered;
  }
  // No declared spawn points -> defer to the caller (null). Returning a
  // hardcoded origin here silently overrode initPlayer's documented x/y/z
  // config, so every fresh scene spawned the player at the origin no matter
  // what the app asked for (and the camera ended up inside whatever the app
  // had built there).
  if (points.length === 0) return null;
  const sp = points[Math.floor(Math.random() * points.length)];
  const JITTER = 1.5; // world units
  return {
    x: sp.position.x + (Math.random() - 0.5) * 2 * JITTER,
    y: sp.position.y,
    z: sp.position.z + (Math.random() - 0.5) * 2 * JITTER,
  };
}

// --- Snap detection (runs throttled in updateParts) ---
function runSnapDetection() {
  if (!workspace.snapEnabled || !physics.rapier || !physics.world) return;

  const dynamicParts = [];
  for (const part of workspace.parts.values()) {
    if (!part.anchored && part._body && part._collider) {
      dynamicParts.push(part);
    }
  }

  for (const part of dynamicParts) {
    // Skip parts in compound blocks (they have their own weld management)
    if (partToCompound.has(part.id)) continue;

    const pos = part._body.translation();
    const nearby = physics.queryNearby(pos, part.size.x / 2 + workspace.snapDistance + 0.5);

    for (const { body: otherBody } of nearby) {
      if (otherBody === part._body) continue;
      if (!otherBody._gip3dwPartId) continue;

      const otherPart = workspace.parts.get(otherBody._gip3dwPartId);
      if (!otherPart) continue;
      if (partToCompound.has(otherPart.id)) continue; // skip compound parts

      // Check if already snapped
      const pairKey = [part.id, otherPart.id].sort().join('-');
      if (snappedPairs.has(pairKey)) continue;

      // Check distance between surfaces
      const otherPos = otherBody.translation();
      const dx = pos.x - otherPos.x;
      const dy = pos.y - otherPos.y;
      const dz = pos.z - otherPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Approximate surface distance (center-to-center minus half-sizes)
      const halfA = Math.max(part.size.x, part.size.y, part.size.z) / 2;
      const halfB = Math.max(otherPart.size.x, otherPart.size.y, otherPart.size.z) / 2;
      const surfaceDist = dist - halfA - halfB;

      if (surfaceDist > workspace.snapDistance) continue;

      // Check rotation alignment (angle between quaternions within tolerance)
      const rotA = part._body.rotation();
      const rotB = otherBody.rotation();
      const dot = Math.abs(rotA.x * rotB.x + rotA.y * rotB.y + rotA.z * rotB.z + rotA.w * rotB.w);
      const angleDiff = 2 * Math.acos(Math.min(dot, 1));

      if (angleDiff > workspace.snapAngle) continue;

      // Snap! Create a weld constraint
      snappedPairs.add(pairKey);
      const constraint = constraintsModule.weld(part, otherPart);
      if (constraint && !snapLogged) {
        snapLogged = true;
        console.info('[Snap] Auto-weld fused two touching Parts into one rigid body (workspace.snapEnabled is true). Welded Parts move as a unit and cannot topple apart - set workspace.snapEnabled = false for free-standing stacks.');
      }

      // Fire snap event
      if (constraint) {
        for (const listener of workspace._snapListeners) {
          try { listener(part, otherPart, constraint); } catch (e) { console.warn('[Snap]', e); }
        }
      }
    }
  }
}

/**
 * Per-frame update: sync Rapier physics transforms → Three.js meshes for all dynamic parts.
 * Also runs throttled snap detection.
 */
// --- Network-correction visual smoothing ---
// When the network adapter snaps a Part's body onto the host transform, the
// body jumps. To avoid a visible pop, the jump is stashed as a render-space
// offset (part._renderErr) and decayed to zero over RENDER_SMOOTH_SEC - the
// mesh is drawn at (body + offset), so it eases over while the body itself
// simulates correctly from the host-authoritative state.
const RENDER_SMOOTH_SEC = 0.12;

/**
 * Apply a host-authoritative correction to a SETTLED Part: snap the body onto
 * the host's exact transform and freeze it (velocity zeroed, body NOT woken).
 *
 * Not waking is the whole point. The host's block is asleep; waking the
 * joiner's copy would make its solver re-resolve the entire stack's contacts
 * every sync - that is the visible "wobble". Left un-woken, an already-asleep
 * block just teleports silently and stays frozen, exactly like the host's.
 *
 * The visual jump is stashed as a decaying render offset so the mesh eases
 * over instead of popping.
 */
function correctPart(part, pos, rot) {
  const body = part && part._body;
  if (!body) return;
  // Where the mesh is shown right now = body + any still-decaying offset.
  const cur = body.translation();
  const e = part._renderErr;
  const shownX = cur.x + (e ? e.x : 0);
  const shownY = cur.y + (e ? e.y : 0);
  const shownZ = cur.z + (e ? e.z : 0);
  // Snap onto the host transform and freeze - no wake (see above).
  body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, false);
  body.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }, false);
  body.setLinvel({ x: 0, y: 0, z: 0 }, false);
  body.setAngvel({ x: 0, y: 0, z: 0 }, false);
  // Keep the mesh visually where it was; updateParts decays the offset.
  part._renderErr = { x: shownX - pos.x, y: shownY - pos.y, z: shownZ - pos.z };
}

function updateParts(dt) {
  // Sync physics → visual for dynamic parts
  for (const part of workspace.parts.values()) {
    if (part.anchored || !part._body) continue;
    const pos = part._body.translation();
    const rot = part._body.rotation();

    part.position.x = pos.x;
    part.position.y = pos.y;
    part.position.z = pos.z;
    part.rotation.x = rot.x;
    part.rotation.y = rot.y;
    part.rotation.z = rot.z;
    part.rotation.w = rot.w;

    // Decay any network-correction render offset toward zero, so a snapped
    // body's mesh eases to its true position instead of popping.
    const err = part._renderErr;
    if (err) {
      const keep = Math.pow(0.0001, dt / RENDER_SMOOTH_SEC);
      err.x *= keep; err.y *= keep; err.z *= keep;
      if (Math.abs(err.x) + Math.abs(err.y) + Math.abs(err.z) < 0.003) part._renderErr = null;
    }

    if (part._mesh) {
      const e = part._renderErr;
      if (e) part._mesh.position.set(pos.x + e.x, pos.y + e.y, pos.z + e.z);
      else part._mesh.position.set(pos.x, pos.y, pos.z);
      part._mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }
  }

  // Throttled snap detection
  snapFrameCounter++;
  if (snapFrameCounter >= SNAP_INTERVAL) {
    snapFrameCounter = 0;
    runSnapDetection();
  }
}

// --- Debug collider wireframes for all parts ---
const debugWireMat = new THREE.LineBasicMaterial({ color: 0xff0, transparent: true, opacity: 0.5 });
let partsDebugVisible = false;

function togglePartColliders(visible) {
  partsDebugVisible = visible;
  for (const part of workspace.parts.values()) {
    if (visible) {
      // Add wireframe if not present
      if (!part._debugWire && part._mesh) {
        const hx = part.size.x;
        const hy = part.size.y;
        const hz = part.size.z;
        const wire = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(hx, hy, hz)),
          debugWireMat,
        );
        part._mesh.add(wire);
        part._debugWire = wire;
      }
      if (part._debugWire) part._debugWire.visible = true;
    } else {
      if (part._debugWire) part._debugWire.visible = false;
    }
  }
}

// --- Compound (destructible) block system ---

const compoundRegistry = new Map();  // compoundId → compound object
const partToCompound = new Map();    // partId → compoundId

let nextCompoundId = 1;

/**
 * Create a destructible compound block - a grid of anchored 1x1x1 Parts.
 * Blocks are static until explicitly broken via breakAt() or break(part).
 * Freed blocks become dynamic and fly/fall with physics.
 *
 * @param {Object} options
 * @param {Object} options.position - Center of the compound {x, y, z}
 * @param {number} options.gridSize - Blocks per axis (default: 3 → 27 blocks)
 * @param {number} options.blockSize - Size of each sub-block (default: 1)
 * @param {number} options.color - Base hex color
 * @param {string} options.material - Material preset (default: 'plastic')
 * @param {boolean} options.colorVariation - Slight color variation per block (default: true)
 * @returns {Object} compound { id, parts[], break(part), breakAt(pos, radius), breakAll(), isIntact() }
 */
function createCompoundBlock(options = {}) {
  const pos = options.position || { x: 0, y: 0, z: 0 };
  const gs = options.gridSize || 3;
  const bs = options.blockSize || 1;
  const baseColor = options.color || 0x888888;
  const material = options.material || 'plastic';
  const colorVariation = options.colorVariation !== false;
  const isAnchored = options.anchored !== false;

  const compoundId = `cpd-${nextCompoundId++}`;
  const grid = [];
  const parts = [];

  // Color helper: vary brightness ±10%
  const baseR = (baseColor >> 16) & 0xff;
  const baseG = (baseColor >> 8) & 0xff;
  const baseB = baseColor & 0xff;

  function variedColor() {
    if (!colorVariation) return baseColor;
    const f = 0.9 + Math.random() * 0.2;
    const r = Math.min(255, Math.round(baseR * f));
    const g = Math.min(255, Math.round(baseG * f));
    const b = Math.min(255, Math.round(baseB * f));
    return (r << 16) | (g << 8) | b;
  }

  const offset = (gs * bs) / 2 - bs / 2;

  // Create all sub-blocks
  for (let x = 0; x < gs; x++) {
    grid[x] = [];
    for (let y = 0; y < gs; y++) {
      grid[x][y] = [];
      for (let z = 0; z < gs; z++) {
        const part = createPart({
          position: {
            x: pos.x + x * bs - offset,
            y: pos.y + y * bs - offset,
            z: pos.z + z * bs - offset,
          },
          size: { x: bs, y: bs, z: bs },
          color: variedColor(),
          material,
          anchored: isAnchored,
          mass: 0.5,
          linearDamping: 0.3,
          angularDamping: 0.8,
        });
        grid[x][y][z] = part;
        parts.push(part);
        part._compoundId = compoundId;
        partToCompound.set(part.id, compoundId);
      }
    }
  }

  const compound = makeCompound(compoundId);
  compound.parts = parts;
  compound.grid = grid;
  compound.gridSize = gs;
  compound.blockSize = bs;
  for (const p of parts) compound._activeParts.add(p.id);

  compoundRegistry.set(compoundId, compound);
  return compound;
}

/**
 * Build an empty compound object (a compoundRegistry value). Sub-blocks are
 * attached either by createCompoundBlock (locally authored) or by
 * addPartToCompound (rebuilt from a host world-state sync). Every break
 * helper reads compound.parts / compound._activeParts so both paths behave
 * identically.
 */
function makeCompound(compoundId) {
  const compound = {
    id: compoundId,
    parts: [],
    grid: null,
    gridSize: 0,
    blockSize: 1,
    _activeParts: new Set(),

    /** Free a specific sub-block - unanchors it so it becomes dynamic */
    break(part) {
      freePart(compound, part);
    },

    /**
     * Break all sub-blocks within radius of a world position.
     * Freed blocks get an impulse away from the impact point.
     * @param {Object} position - {x, y, z} world-space impact point
     * @param {number} radius - blast radius
     * @param {number} force - impulse strength (default: 10)
     * @returns {number} count of blocks freed
     */
    breakAt(position, radius, force = 10) {
      let freed = 0;
      for (const part of [...compound.parts]) {
        if (!compound._activeParts.has(part.id)) continue;
        const dx = part.position.x - position.x;
        const dy = part.position.y - position.y;
        const dz = part.position.z - position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > radius) continue;

        freePart(compound, part);

        // Apply impulse away from impact
        if (part._body && force > 0 && dist > 0.01) {
          const falloff = 1 - dist / radius;
          const strength = force * falloff;
          const nx = dx / dist, ny = dy / dist, nz = dz / dist;
          part._body.applyImpulse({ x: nx * strength, y: ny * strength + strength * 0.5, z: nz * strength }, true);
        }
        freed++;
      }
      return freed;
    },

    /** Shatter the entire compound */
    breakAll() {
      for (const p of [...compound.parts]) {
        if (compound._activeParts.has(p.id)) freePart(compound, p);
      }
    },

    /** Check if any blocks are still anchored */
    isIntact() {
      return compound._activeParts.size > 0;
    },
  };
  return compound;
}

/**
 * Attach an already-created Part to a compound, creating the compound entry
 * if it doesn't exist yet. Used to rebuild compound blocks on a client that
 * received the world as a flat host sync: the host serializes sub-blocks as
 * individual Parts, so without this they land ungrouped and breakCompoundsAt()
 * finds nothing - the red destructible blocks become unbreakable for joiners.
 */
function addPartToCompound(compoundId, part) {
  let compound = compoundRegistry.get(compoundId);
  if (!compound) {
    compound = makeCompound(compoundId);
    compoundRegistry.set(compoundId, compound);
  }
  if (!compound._activeParts.has(part.id)) {
    compound.parts.push(part);
    compound._activeParts.add(part.id);
  }
  part._compoundId = compoundId;
  partToCompound.set(part.id, compoundId);
  return compound;
}

/**
 * Drop a part from whatever compound it belongs to (registry + lookup map).
 * Called when a synced part is unanchored by a host delta - the host already
 * broke it, so the local compound must forget it too or a later local break
 * would re-free (and re-impulse) an already-flying block.
 */
function releaseFromCompound(part) {
  const compoundId = partToCompound.get(part.id);
  if (!compoundId) return;
  partToCompound.delete(part.id);
  const compound = compoundRegistry.get(compoundId);
  if (compound) {
    compound._activeParts.delete(part.id);
    if (compound._activeParts.size === 0) compoundRegistry.delete(compoundId);
  }
}

/** Free a single part from its compound - unanchor it */
function freePart(compound, part) {
  if (!compound._activeParts.has(part.id)) return;

  // Unanchor so it becomes a dynamic physics body
  if (part.anchored) {
    setProperty(part, 'anchored', false);
  }

  compound._activeParts.delete(part.id);
  partToCompound.delete(part.id);

  // If all blocks freed, remove compound from registry
  if (compound._activeParts.size === 0) {
    compoundRegistry.delete(compound.id);
  }
}

/**
 * Break compound blocks near a world position. Call this from explosion/impact code.
 * Searches all compounds for sub-blocks within radius and frees them.
 * @param {Object} position - {x, y, z}
 * @param {number} radius - blast radius
 * @param {number} force - impulse strength (default: 10)
 * @returns {number} total blocks freed
 */
function breakCompoundsAt(position, radius, force = 10) {
  let totalFreed = 0;
  for (const compound of compoundRegistry.values()) {
    totalFreed += compound.breakAt(position, radius, force);
  }
  return totalFreed;
}

/**
 * True if `part` is an anchored sub-block of a compound that has had NO blocks
 * freed yet. Such a part is bit-identical on every client and cannot have
 * diverged, so multiplayer sync can skip it until the compound is disturbed.
 */
function isInIntactCompound(part) {
  if (!part || !part._compoundId) return false;
  const compound = compoundRegistry.get(part._compoundId);
  if (!compound) return false;
  return compound._activeParts.size === compound.parts.length;
}

export {
  workspace,
  createPart,
  removePart,
  setProperty,
  getPart,
  getParts,
  queryParts,
  detachPart,
  createSpawnPoint,
  getSpawnPosition,
  updateParts,
  togglePartColliders,
  createCompoundBlock,
  addPartToCompound,
  releaseFromCompound,
  breakCompoundsAt,
  isInIntactCompound,
  correctPart,
  SHAPES,
};
