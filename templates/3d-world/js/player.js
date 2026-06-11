/**
 * 3D World - Player Controller
 * Character movement, camera, and input.
 *
 * Physics model: the player is a DYNAMIC rigid body (additional mass 2), so
 * it shoves and knocks over dynamic Parts on contact for free. Its rotation
 * is locked so it stays upright and never topples.
 *
 * Controls (configurable via initPlayer config):
 *   - Right-click + drag: orbit camera (works without pointer lock, Roblox-style)
 *   - Left-click (on canvas): locks pointer for always-on mouse look
 *   - Left-click (when locked): action/shoot (inputState.mouseDown)
 *   - Scroll wheel: zoom in/out (first-person when fully zoomed)
 *   - WASD/arrows: move relative to camera
 *   - Space: jump, E: interact
 *   - Crosshair always visible at screen center
 *   - Camera modes: orbit (default), firstPerson, topDown, fixed
 *
 * Exports: initPlayer, updatePlayer, getPosition, setPosition,
 *          getAimDirection, getAimOrigin, playerMesh, inputState, velocity
 */
import { scene, camera, renderer, THREE } from './world.js';
import * as physics from './physics.js';
import { togglePartColliders } from './primitives.js';

// Defaults - overridden by config passed to initPlayer()
// World scale: 1 voxel = 1 world unit. Standard block = 3x3x3. Player = 5u tall, 4u arm span.
let MOVE_SPEED = 15;
let JUMP_FORCE = 22;
let GRAVITY = -40;
let CAM_MIN_DIST = 2;
let CAM_MAX_DIST = 60;
let CAM_DEFAULT_DIST = 30;
let CAM_HEIGHT_OFFSET = 5;
let CAM_LERP = 10;
let CAM_MIN_Y = 2.0;
let PITCH_MIN = -1.5;
let PITCH_MAX = 1.5;
let MOUSE_SENSITIVITY = 0.003;
let SCROLL_SPEED = 3;
let SHOW_CROSSHAIR = true;
let PLAYER_HALF_HEIGHT = 2.5;  // half of 5u tall model
let PLAYER_HALF_WIDTH = 1.0;   // half of 2u body width
let PLAYER_FOOT_OFFSET = 2.4;  // distance from mesh origin (y=0) to shoe bottom (y=-2.4)
let ACCEL_TIME = 0.2; // seconds to reach full speed
const KNOCKBACK_RECOVERY = 0.45; // seconds a blast impulse carries the body before control resumes

// Camera mode: 'orbit' | 'firstPerson' | 'topDown' | 'fixed'
let cameraMode = 'orbit';

// Top-down camera settings
let TOP_DOWN_HEIGHT = 30;
let TOP_DOWN_ANGLE = -Math.PI / 2; // straight down
let TOP_DOWN_LERP = 8;

// Fixed camera settings (scriptable)
let fixedCamPos = { x: 0, y: 10, z: 10 };
let fixedCamLookAt = { x: 0, y: 0, z: 0 };

let playerMesh = null;
let playerBody = null;
let playerColor = 0xf26522;     // this player's avatar color (synced to peers)
let frozen = false;             // true while waiting for the host's world sync
let velocity = { x: 0, y: 0, z: 0 };
let grounded = false;
let jumpCooldown = 0; // seconds remaining to ignore ground ray after jump
let speedFactor = 0; // 0..1, ramps up over ACCEL_TIME
let knockbackTimer = 0; // seconds the movement controller yields to blast impulse
let inputState = { forward: 0, right: 0, jump: false, action: false, mouseDown: false, sprint: false };
let isMobile = false;

// Camera state
let yaw = 0;
let pitch = 0.3;
let camDist = 30;
let pointerLocked = false;
let rightDown = false;

// Touch state
let joystickActive = false;
let joystickStart = { x: 0, y: 0 };

// Crosshair
let crosshair = null;

// Debug collider wireframes
let debugCollidersVisible = false;
let debugBodyWire = null;
let debugArmWire = null;

/**
 * Build a blocky person model from box primitives. Forward = +Z local.
 * Total height = 5u, centered at y=0 (bottom at -2.4, top at +2.6).
 * Scale: 1 voxel = 1 world unit. Standard block = 3x3x3.
 * Body = 2u wide, arms = 1u wide each, total span = 4u.
 *
 * The model is built with animatable joints (see animatePlayerModel):
 *   - `core` group (origin) holds the torso/head/face/hair + both arm pivots,
 *     so the hit-reaction can recoil the upper body without moving the legs.
 *   - each arm/leg is a pivot THREE.Group placed AT its shoulder/hip joint,
 *     with the box meshes offset downward inside it - rotating the pivot
 *     swings the limb. At zero rotation the rest pose is unchanged.
 * References are stashed on `group.userData.anim` so the shared animator can
 * drive any model instance (local player or remote peer).
 */
function buildPlayerModel(color) {
  const group = new THREE.Group();
  const S = { shadowSide: THREE.BackSide };

  const bodyMat = new THREE.MeshLambertMaterial({ color, ...S });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xf5c6a0, ...S });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x222222, ...S });
  const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff, ...S });
  const hairMat = new THREE.MeshLambertMaterial({ color: 0x3a2a1a, ...S });
  const legColor = new THREE.Color(color).lerp(new THREE.Color(0x000000), 0.2);
  const legMat = new THREE.MeshLambertMaterial({ color: legColor, ...S });

  // Upper body - leaning `core` recoils torso+head+arms together for the hit
  // reaction; legs stay planted because they hang off `group` directly.
  const core = new THREE.Group();
  group.add(core);

  // Limb pivots, placed at the joint. Arm shoulder = top of the arm box
  // (centred y=0.2, 1.6 tall -> top y=1.0). Leg hip = top of the leg box
  // (centred y=-1.3, 1.4 tall -> top y=-0.6).
  const leftArm  = new THREE.Group(); leftArm.position.set(-1.3, 1.0, 0);  core.add(leftArm);
  const rightArm = new THREE.Group(); rightArm.position.set(1.3, 1.0, 0);  core.add(rightArm);
  const leftLeg  = new THREE.Group(); leftLeg.position.set(-0.5, -0.6, 0); group.add(leftLeg);
  const rightLeg = new THREE.Group(); rightLeg.position.set(0.5, -0.6, 0); group.add(rightLeg);

  // box(): add a static mesh to `parent` (defaults to core). Limb meshes pass
  // their pivot group and use offsets relative to the joint.
  function box(geo, mat, x, y, z, parent = core) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // -- 5u tall: bottom=-2.4, top=+2.6, centered at y=0 --

  // Torso: 2u wide × 1.6u tall × 1u deep
  box(new THREE.BoxGeometry(2, 1.6, 1), bodyMat, 0, 0.2, 0);

  // Head: 1.3u cube, skin-colored
  box(new THREE.BoxGeometry(1.3, 1.3, 1.3), skinMat, 0, 1.65, 0);

  // Eyes on front face (+Z = forward)
  box(new THREE.BoxGeometry(0.3, 0.25, 0.1), whiteMat, -0.28, 1.75, 0.66);
  box(new THREE.BoxGeometry(0.3, 0.25, 0.1), whiteMat, 0.28, 1.75, 0.66);
  // Pupils
  box(new THREE.BoxGeometry(0.15, 0.18, 0.06), darkMat, -0.24, 1.75, 0.72);
  box(new THREE.BoxGeometry(0.15, 0.18, 0.06), darkMat, 0.24, 1.75, 0.72);

  // Smile
  box(new THREE.BoxGeometry(0.5, 0.1, 0.06), darkMat, 0, 1.35, 0.66);

  // Arms: 1u wide × 1.6u tall × 0.6u deep. Pivot at shoulder (y=1.0), so the
  // arm box (world y=0.2) sits at offset -0.8 and the hand (world y=-0.8) at -1.8.
  box(new THREE.BoxGeometry(0.6, 1.6, 0.6), bodyMat, 0, -0.8, 0, leftArm);
  box(new THREE.BoxGeometry(0.5, 0.4, 0.5), skinMat, 0, -1.8, 0, leftArm);
  box(new THREE.BoxGeometry(0.6, 1.6, 0.6), bodyMat, 0, -0.8, 0, rightArm);
  box(new THREE.BoxGeometry(0.5, 0.4, 0.5), skinMat, 0, -1.8, 0, rightArm);

  // Legs: 0.8u wide × 1.4u tall × 0.9u deep. Pivot at hip (y=-0.6), so the leg
  // box (world y=-1.3) sits at offset -0.7 and the shoe (world y=-2.18) at -1.58.
  box(new THREE.BoxGeometry(0.8, 1.4, 0.9), legMat, 0, -0.7, 0, leftLeg);
  box(new THREE.BoxGeometry(0.8, 0.35, 1.1), darkMat, 0, -1.58, 0.1, leftLeg);
  box(new THREE.BoxGeometry(0.8, 1.4, 0.9), legMat, 0, -0.7, 0, rightLeg);
  box(new THREE.BoxGeometry(0.8, 0.35, 1.1), darkMat, 0, -1.58, 0.1, rightLeg);

  // Hair - bowl cut, so the head reads as a person from every angle.
  // Head cube spans y 1.0-2.3, x/z -0.65..0.65.
  // Crown: caps the top of the head with a slight overhang.
  box(new THREE.BoxGeometry(1.5, 0.45, 1.5), hairMat, 0, 2.4, 0);
  // Back panel: covers the back of the head down to the neck - this is the
  // fix for the "faceless from behind" look.
  box(new THREE.BoxGeometry(1.5, 1.05, 0.32), hairMat, 0, 1.78, -0.66);
  // Side panels: frame the face and cover the ears area. Depth/offset kept so
  // no face is coplanar with the head cube (z=±0.65) - coincident faces
  // z-fight and flicker.
  box(new THREE.BoxGeometry(0.32, 0.85, 1.3), hairMat, -0.66, 1.92, -0.12);
  box(new THREE.BoxGeometry(0.32, 0.85, 1.3), hairMat, 0.66, 1.92, -0.12);
  // Fringe: a short bang over the forehead so the front isn't a bare helmet.
  box(new THREE.BoxGeometry(1.5, 0.32, 0.22), hairMat, 0, 2.18, 0.62);

  // Animation joints + per-model state (persists across frames).
  group.userData.anim = {
    core, leftArm, rightArm, leftLeg, rightLeg, phase: 0, bob: 0,
    // Eased walk-pose values, kept off the meshes so the hit springs can be a
    // clean additive layer rather than fighting the ease.
    lArmE: 0, rArmE: 0, lLegE: 0, rLegE: 0, bobE: 0,
    // Hit-reaction spring DOFs - angle + angular velocity, all rest at 0.
    hit: {
      pitch: 0, pitchV: 0, roll: 0, rollV: 0, yaw: 0, yawV: 0,
      armX: 0, armXV: 0, armZ: 0, armZV: 0,
    },
  };

  return group;
}

// --- Procedural animation tuning ---
const ANIM_WALK_FREQ = 2.2;   // stride cycles/sec at reference (MOVE_SPEED) speed
const ANIM_WALK_AMP = 0.9;    // max leg swing, radians
const ANIM_ARM_RATIO = 0.7;   // arm swing amplitude relative to legs

// Hit-reaction spring-dampers. The torso (pitch/roll), the whole-body yaw and
// the arm fling are each a 1-DOF spring: a hit kicks its velocity, then it
// oscillates back to rest. Underdamped (one small overshoot) for a natural
// lurch-and-settle. omega = sqrt(K); zeta = D / (2*sqrt(K)).
const HIT_SPRING_K = 120;
const HIT_SPRING_D = 11;
const HIT_TORQUE_GAIN = 7;    // impact torque -> torso pitch/roll velocity kick
const HIT_YAW_GAIN = 11;      // impact torque -> whole-body yaw velocity kick
const HIT_ARM_GAIN = 13;      // impact force  -> arm-fling velocity kick

/** Integrate one hit-reaction spring-damper DOF back toward rest (0). */
function stepHitSpring(hit, key, dt, clamp) {
  const vk = key + 'V';
  hit[vk] += (-HIT_SPRING_K * hit[key] - HIT_SPRING_D * hit[vk]) * dt;
  hit[key] += hit[vk] * dt;
  if (hit[key] > clamp) { hit[key] = clamp; hit[vk] = 0; }
  else if (hit[key] < -clamp) { hit[key] = -clamp; hit[vk] = 0; }
}

/**
 * Kick the hit-reaction springs from a real impact. `F` is the unit force
 * direction and `r` the impact-point offset from the body centre, BOTH in the
 * model's local frame (x=right, y=up, z=forward). torque = r x F decides how
 * the body pitches / yaws / rolls; the linear force flings the arms. After the
 * kick the springs settle home on their own. Used for the local player and,
 * via the 'hit' network message, for remote peers.
 */
function kickHitSprings(model, F, r) {
  const a = model && model.userData && model.userData.anim;
  if (!a) return;
  const hit = a.hit;
  hit.pitchV += (r.y * F.z - r.z * F.y) * HIT_TORQUE_GAIN;  // torque about right
  hit.yawV   += (r.z * F.x - r.x * F.z) * HIT_YAW_GAIN;     // torque about up
  hit.rollV  += (r.x * F.y - r.y * F.x) * HIT_TORQUE_GAIN;  // torque about forward
  hit.armXV  += -F.z * HIT_ARM_GAIN;   // forward shove -> arms fling forward
  hit.armZV  +=  F.x * HIT_ARM_GAIN;   // rightward shove -> arms fling right
}

/**
 * Procedurally animate a player model built by buildPlayerModel - the walk
 * cycle, idle breathing, airborne pose, and the hit-reaction springs. Shared
 * by the local player (updatePlayer) and remote peers (multiplayer feature).
 * The hit reaction is injected separately via kickHitSprings; here it is just
 * integrated each frame as it settles back to rest.
 *
 *   model - a THREE.Group from buildPlayerModel (has userData.anim)
 *   state - { speed, grounded }
 *     speed   - horizontal speed in units/sec
 *     grounded- false while airborne (defaults to true if omitted)
 *   dt    - frame delta, seconds
 */
function animatePlayerModel(model, state, dt) {
  const a = model && model.userData && model.userData.anim;
  if (!a) return;
  const { core, leftArm, rightArm, leftLeg, rightLeg, hit } = a;
  const speed = state.speed || 0;
  const grounded = state.grounded !== false;
  const norm = Math.min(speed / MOVE_SPEED, 1.6);
  const moving = grounded && norm > 0.06;

  // --- Walk / idle / jump pose targets ---
  let lArm = 0, rArm = 0, lLeg = 0, rLeg = 0, coreBob = 0;
  if (!grounded) {
    // Airborne: tuck the legs up and swing both arms up the same way.
    lLeg = rLeg = -0.5;
    lArm = rArm = -1.0;
  } else if (moving) {
    // Walk cycle: legs counter-swing; arms counter the opposite leg.
    const freq = ANIM_WALK_FREQ * Math.max(norm, 0.4);
    a.phase += freq * dt * Math.PI * 2;
    const amp = ANIM_WALK_AMP * Math.min(norm, 1.15);
    const s = Math.sin(a.phase);
    lLeg = s * amp;
    rLeg = -s * amp;
    lArm = -s * amp * ANIM_ARM_RATIO;
    rArm = s * amp * ANIM_ARM_RATIO;
  } else {
    // Idle: gentle breathing bob; decay the walk phase back toward neutral.
    a.bob += dt;
    coreBob = Math.sin(a.bob * 1.9) * 0.035;
    a.phase *= 1 - Math.min(dt * 6, 1);
  }

  // Ease the walk pose (stored on `a`) so jump/stop transitions don't pop.
  const k = Math.min(dt * 14, 1);
  a.lArmE += (lArm - a.lArmE) * k;
  a.rArmE += (rArm - a.rArmE) * k;
  a.lLegE += (lLeg - a.lLegE) * k;
  a.rLegE += (rLeg - a.rLegE) * k;
  a.bobE  += (coreBob - a.bobE) * k;

  // --- Hit reaction: spring-dampers settling back to rest, kicked from a real
  //     impact by kickHitSprings. The torso bends on its spine, the arms fling,
  //     and the whole body yaws - each just oscillates home. Zero cost when
  //     nothing was hit (every DOF sits at 0). ---
  stepHitSpring(hit, 'pitch', dt, 0.9);
  stepHitSpring(hit, 'roll',  dt, 0.9);
  stepHitSpring(hit, 'yaw',   dt, 1.2);
  stepHitSpring(hit, 'armX',  dt, 1.5);
  stepHitSpring(hit, 'armZ',  dt, 1.5);

  // --- Compose: walk pose + hit springs ---
  leftArm.rotation.x  = a.lArmE + hit.armX;
  rightArm.rotation.x = a.rArmE + hit.armX;
  leftArm.rotation.z  = hit.armZ;
  rightArm.rotation.z = hit.armZ;
  leftLeg.rotation.x  = a.lLegE;
  rightLeg.rotation.x = a.rLegE;
  core.rotation.x     = hit.pitch;   // torso pitches on its spine
  core.rotation.z     = hit.roll;    // torso rolls on its spine
  core.position.y     = a.bobE;
  model.rotation.y   += hit.yaw;     // whole body yaws - the visible facing kick
}

/** Initialize the player character */
function initPlayer(config = {}) {
  // Apply config
  if (config.speed !== undefined) MOVE_SPEED = config.speed;
  if (config.jumpForce !== undefined) JUMP_FORCE = config.jumpForce;
  if (config.gravity !== undefined) GRAVITY = config.gravity;
  if (config.crosshair !== undefined) SHOW_CROSSHAIR = config.crosshair;

  const cam = config.camera || {};
  if (cam.distance !== undefined) { CAM_DEFAULT_DIST = cam.distance; camDist = cam.distance; }
  if (cam.minDistance !== undefined) CAM_MIN_DIST = cam.minDistance;
  if (cam.maxDistance !== undefined) CAM_MAX_DIST = cam.maxDistance;
  if (cam.heightOffset !== undefined) CAM_HEIGHT_OFFSET = cam.heightOffset;
  if (cam.sensitivity !== undefined) MOUSE_SENSITIVITY = cam.sensitivity;
  if (cam.scrollSpeed !== undefined) SCROLL_SPEED = cam.scrollSpeed;
  if (cam.mode !== undefined) cameraMode = cam.mode;
  if (cam.topDownHeight !== undefined) TOP_DOWN_HEIGHT = cam.topDownHeight;

  // Determine spawn position: use SpawnPoint if available, else config/defaults
  let spawnX = config.x || 0;
  let spawnY = config.y || 3;
  let spawnZ = config.z || 0;

  // Check for workspace spawn points (primitives module sets these)
  if (typeof window._gip3dwGetSpawnPosition === 'function') {
    const sp = window._gip3dwGetSpawnPosition(config.teamColor || null);
    if (sp) { spawnX = sp.x; spawnY = sp.y; spawnZ = sp.z; }
  }

  // Create player mesh - blocky person built from box primitives
  const color = config.color || 0xf26522;
  playerColor = color;
  playerMesh = buildPlayerModel(color);
  playerMesh.position.set(spawnX, spawnY, spawnZ);
  scene.add(playerMesh);

  // Create player physics body (dynamic - has real mass, Rapier handles collisions)
  if (physics.rapier && physics.world) {
    const pos = playerMesh.position;
    const bodyDesc = physics.rapier.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setAdditionalMass(2)
      .setLinearDamping(0.1)
      .setAngularDamping(100)
      .setCcdEnabled(true)
      .lockRotations();          // stay upright, never topple
    playerBody = physics.world.createRigidBody(bodyDesc);

    // Body collider: feet-to-head, tight to torso/legs width
    const bodyCollider = physics.rapier.ColliderDesc.cuboid(0.9, PLAYER_HALF_HEIGHT, 0.5)
      .setTranslation(0, 0.1, 0)
      .setFriction(0.0)
      .setDensity(0.1);
    physics.world.createCollider(bodyCollider, playerBody);

    // Arm collider: wider but shorter, covers arm span
    const armCollider = physics.rapier.ColliderDesc.cuboid(1.6, 0.8, 0.3)
      .setTranslation(0, 0.2, 0)
      .setFriction(0.0)
      .setDensity(0.05);
    physics.world.createCollider(armCollider, playerBody);

    // Debug wireframes
    const wireMat = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.6 });
    debugBodyWire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.8, PLAYER_HALF_HEIGHT * 2, 1.0)),
      wireMat,
    );
    debugBodyWire.position.y = 0.1;
    debugBodyWire.visible = false;
    playerMesh.add(debugBodyWire);

    debugArmWire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(3.2, 1.6, 0.6)),
      new THREE.LineBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.6 }),
    );
    debugArmWire.position.y = 0.2;
    debugArmWire.visible = false;
    playerMesh.add(debugArmWire);

    // Restore collider debug state from localStorage
    try { debugCollidersVisible = localStorage.getItem('gip3dw_debug_colliders') === '1'; } catch {}
    if (debugCollidersVisible) {
      if (debugBodyWire) debugBodyWire.visible = true;
      debugArmWire.visible = true;
      setTimeout(() => togglePartColliders(true), 500);
    }
  }

  isMobile = 'ontouchstart' in window && window.innerWidth < 1024;

  if (SHOW_CROSSHAIR) createCrosshairEl();
  setupKeyboard();
  setupMouse();
  if (isMobile) {
    setupTouch();
    document.getElementById('mobile-controls')?.classList.remove('hidden');
  }

  // Ensure mobile controls stay hidden on desktop
  if (!isMobile) {
    const mc = document.getElementById('mobile-controls');
    if (mc) { mc.classList.add('hidden'); mc.style.display = 'none'; }
  }

  return playerMesh;
}

function createCrosshairEl() {
  crosshair = document.createElement('div');
  crosshair.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:20px;height:20px;pointer-events:none;z-index:100;';
  crosshair.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20">
    <circle cx="10" cy="10" r="3" fill="none" stroke="white" stroke-width="1.5" opacity="0.8"/>
    <line x1="10" y1="0" x2="10" y2="6" stroke="white" stroke-width="1.5" opacity="0.6"/>
    <line x1="10" y1="14" x2="10" y2="20" stroke="white" stroke-width="1.5" opacity="0.6"/>
    <line x1="0" y1="10" x2="6" y2="10" stroke="white" stroke-width="1.5" opacity="0.6"/>
    <line x1="14" y1="10" x2="20" y2="10" stroke="white" stroke-width="1.5" opacity="0.6"/>
  </svg>`;
  document.body.appendChild(crosshair);
}

/** Update player each frame */
function updatePlayer(dt) {
  if (!playerMesh || !playerBody) return;

  // Frozen: a non-host joiner is held in place until the host's world sync
  // lands - so it can't fall through / walk past blocks that aren't there yet.
  if (frozen) {
    playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    playerBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    playerMesh.position.copy(playerBody.translation());
    return;
  }

  // Movement direction relative to camera yaw
  const fwd = inputState.forward;
  const rgt = inputState.right;
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const dirX = sinYaw * fwd - cosYaw * rgt;
  const dirZ = cosYaw * fwd + sinYaw * rgt;
  const len = Math.sqrt(dirX * dirX + dirZ * dirZ);

  // Speed ramp
  if (len > 0) {
    speedFactor = Math.min(1, speedFactor + dt / ACCEL_TIME);
  } else {
    speedFactor = 0;
  }

  // Set horizontal velocity - Rapier handles all collision response
  const curVel = playerBody.linvel();
  let vx = 0, vz = 0;
  if (len > 0) {
    const speed = MOVE_SPEED * speedFactor * speedFactor * (inputState.sprint ? 2.5 : 1);
    vx = (dirX / len) * speed;
    vz = (dirZ / len) * speed;
  }
  // Knockback recovery: just after a blast, let the body coast on the impulse
  // instead of the movement controller cancelling it the same frame - that is
  // what makes a hit player visibly slide. Control resumes when the timer ends.
  if (knockbackTimer > 0) {
    knockbackTimer -= dt;
  } else {
    playerBody.setLinvel({ x: vx, y: curVel.y, z: vz }, true);
  }

  // Ground detection - short ray down from near feet
  // Skip check briefly after jumping so upward velocity has time to lift the player
  if (jumpCooldown > 0) {
    jumpCooldown -= dt;
    grounded = false;
  } else {
    grounded = false;
    const pos2 = playerBody.translation();
    if (physics.rapier && physics.world) {
      const rayOrigin = { x: pos2.x, y: pos2.y - PLAYER_FOOT_OFFSET + 0.3, z: pos2.z };
      const hit = physics.castRay(rayOrigin, { x: 0, y: -1, z: 0 }, 0.5, playerBody);
      if (hit) grounded = true;
    }
  }

  // Jump - set vertical velocity directly (independent of mass)
  if (inputState.jump) {
    if (grounded) {
      const vel = playerBody.linvel();
      playerBody.setLinvel({ x: vel.x, y: JUMP_FORCE, z: vel.z }, true);
      grounded = false;
      jumpCooldown = 0.15; // ignore ground ray for 150ms after jump
    }
    inputState.jump = false;
  }

  // Track velocity for external use
  velocity.x = curVel.x;
  velocity.y = curVel.y;
  velocity.z = curVel.z;

  // Sync mesh FROM physics body (body is authoritative)
  const pos = playerBody.translation();
  playerMesh.position.set(pos.x, pos.y, pos.z);
  playerMesh.rotation.y = yaw;

  // Procedural animation - walk/idle/jump pose + the hit-reaction springs.
  const hSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
  animatePlayerModel(playerMesh, { speed: hSpeed, grounded }, dt);

  // Camera mode handling
  if (cameraMode === 'firstPerson') {
    playerMesh.visible = false;
    const eyeY = playerMesh.position.y + PLAYER_HALF_HEIGHT * 0.7;
    camera.position.set(playerMesh.position.x, eyeY, playerMesh.position.z);
    // Look in movement direction
    const lookDist = 10;
    camera.lookAt(
      playerMesh.position.x + Math.sin(yaw) * lookDist,
      eyeY - Math.sin(pitch) * lookDist,
      playerMesh.position.z + Math.cos(yaw) * lookDist,
    );
  } else if (cameraMode === 'topDown') {
    playerMesh.visible = true;
    const targetX = playerMesh.position.x;
    const targetZ = playerMesh.position.z;
    camera.position.x += (targetX - camera.position.x) * TOP_DOWN_LERP * dt;
    camera.position.y += (TOP_DOWN_HEIGHT - camera.position.y) * TOP_DOWN_LERP * dt;
    camera.position.z += (targetZ + 0.01 - camera.position.z) * TOP_DOWN_LERP * dt; // slight offset to avoid gimbal lock
    camera.lookAt(camera.position.x, 0, camera.position.z - 0.01);
  } else if (cameraMode === 'fixed') {
    playerMesh.visible = true;
    camera.position.set(fixedCamPos.x, fixedCamPos.y, fixedCamPos.z);
    camera.lookAt(fixedCamLookAt.x, fixedCamLookAt.y, fixedCamLookAt.z);
  } else {
    // Default: orbit (existing behavior)
    playerMesh.visible = camDist > CAM_MIN_DIST;
    const lookY = playerMesh.position.y + CAM_HEIGHT_OFFSET;
    const cosPitch2 = Math.cos(pitch);
    const sinPitch2 = Math.sin(pitch);
    const targetX = playerMesh.position.x - sinYaw * camDist * cosPitch2;
    const targetZ = playerMesh.position.z - cosYaw * camDist * cosPitch2;
    const targetY = lookY + sinPitch2 * camDist;

    camera.position.x += (targetX - camera.position.x) * CAM_LERP * dt;
    camera.position.y += (Math.max(targetY, CAM_MIN_Y) - camera.position.y) * CAM_LERP * dt;
    camera.position.z += (targetZ - camera.position.z) * CAM_LERP * dt;
    camera.lookAt(playerMesh.position.x, lookY, playerMesh.position.z);
  }
}

/** Get player world position */
function getPosition() {
  if (playerBody) {
    const p = playerBody.translation();
    return { x: p.x, y: p.y, z: p.z };
  }
  if (playerMesh) return { x: playerMesh.position.x, y: playerMesh.position.y, z: playerMesh.position.z };
  return { x: 0, y: 0, z: 0 };
}

/** Set player position (teleport) */
function setPosition(x, y, z) {
  if (playerBody) {
    playerBody.setTranslation({ x, y, z }, true);
    playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true); // reset velocity on teleport
  }
  if (playerMesh) playerMesh.position.set(x, y, z);
}

/** Get camera aim direction (for shooting from crosshair) */
function getAimDirection() {
  const dir = new THREE.Vector3(0, 0, -1);
  camera.getWorldDirection(dir);
  return { x: dir.x, y: dir.y, z: dir.z };
}

/** Get camera position (ray origin for shooting) */
function getAimOrigin() {
  return { x: camera.position.x, y: camera.position.y, z: camera.position.z };
}

// --- Input: Keyboard ---
function setupKeyboard() {
  const keys = {};
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    updateInputFromKeys(keys);
    if (e.code === 'Space') { inputState.jump = true; e.preventDefault(); }
    if (e.code === 'KeyE') inputState.action = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inputState.sprint = true;
    if (e.code === 'KeyY') {
      debugCollidersVisible = !debugCollidersVisible;
      if (debugBodyWire) debugBodyWire.visible = debugCollidersVisible;
      if (debugArmWire) debugArmWire.visible = debugCollidersVisible;
      togglePartColliders(debugCollidersVisible);
      try { localStorage.setItem('gip3dw_debug_colliders', debugCollidersVisible ? '1' : '0'); } catch {}
      console.log(`[Player] Collider debug: ${debugCollidersVisible ? 'ON' : 'OFF'}`);
    }
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    updateInputFromKeys(keys);
    if (e.code === 'KeyE') inputState.action = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inputState.sprint = false;
  });
}

function updateInputFromKeys(keys) {
  inputState.forward = (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
  inputState.right = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
}

// --- Input: Mouse ---
// Roblox-style controls:
//   - Normal: cursor visible, left-click = action/interact
//   - Right-click hold: locks pointer, orbits camera
//   - Scroll: zoom in/out
function setupMouse() {
  const canvas = renderer.domElement;

  // Prevent context menu on canvas
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Right-click: lock pointer for camera orbit
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      rightDown = true;
      canvas.requestPointerLock().catch(() => {});
    }
    if (e.button === 0) inputState.mouseDown = true;
  });

  document.addEventListener('mouseup', (e) => {
    if (e.button === 2) {
      rightDown = false;
      if (document.pointerLockElement) document.exitPointerLock();
    }
    if (e.button === 0) inputState.mouseDown = false;
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
  });

  // Camera orbit: only when right-click dragging (pointer locked)
  document.addEventListener('mousemove', (e) => {
    if (rightDown && pointerLocked) {
      yaw -= e.movementX * MOUSE_SENSITIVITY;
      pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch - e.movementY * MOUSE_SENSITIVITY));
    }
  });

  // Scroll to zoom
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camDist = Math.max(CAM_MIN_DIST, Math.min(CAM_MAX_DIST, camDist + Math.sign(e.deltaY) * SCROLL_SPEED));
  }, { passive: false });
}

// --- Input: Touch ---
function setupTouch() {
  const zone = document.getElementById('joystick-zone');
  const jumpBtn = document.getElementById('btn-jump');
  const actionBtn = document.getElementById('btn-action');

  if (zone) {
    zone.addEventListener('touchstart', (e) => {
      joystickActive = true;
      joystickStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });
    zone.addEventListener('touchmove', (e) => {
      if (!joystickActive) return;
      const t = e.touches[0];
      const maxDist = 60;
      inputState.right = Math.max(-1, Math.min(1, (t.clientX - joystickStart.x) / maxDist));
      inputState.forward = Math.max(-1, Math.min(1, -(t.clientY - joystickStart.y) / maxDist));
    }, { passive: true });
    zone.addEventListener('touchend', () => {
      joystickActive = false;
      inputState.forward = 0;
      inputState.right = 0;
    }, { passive: true });
  }

  // Right side of screen: camera drag
  let touchCamId = null;
  let touchCamLast = { x: 0, y: 0 };
  renderer.domElement.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (t.clientX > window.innerWidth * 0.5 && touchCamId === null) {
        touchCamId = t.identifier;
        touchCamLast = { x: t.clientX, y: t.clientY };
      }
    }
  }, { passive: true });
  renderer.domElement.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchCamId) {
        yaw -= (t.clientX - touchCamLast.x) * MOUSE_SENSITIVITY * 2;
        pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch - (t.clientY - touchCamLast.y) * MOUSE_SENSITIVITY * 2));
        touchCamLast = { x: t.clientX, y: t.clientY };
      }
    }
  }, { passive: true });
  renderer.domElement.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchCamId) touchCamId = null;
    }
  }, { passive: true });

  if (jumpBtn) jumpBtn.addEventListener('touchstart', () => { inputState.jump = true; }, { passive: true });
  if (actionBtn) {
    actionBtn.addEventListener('touchstart', () => { inputState.action = true; }, { passive: true });
    actionBtn.addEventListener('touchend', () => { inputState.action = false; }, { passive: true });
  }
}

// --- Multiplayer hooks ---

/** Freeze the player in place (used while waiting for the host's world sync). */
function freezePlayer() { frozen = true; }
/** Release a frozen player. */
function unfreezePlayer() { frozen = false; }
/** True while the player is frozen waiting for a world sync. */
function isFrozen() { return frozen; }
/** This player's avatar color (broadcast to peers via presence). */
function getPlayerColor() { return playerColor; }

/** True while the player is standing on ground (broadcast to peers for jump anim). */
function isGrounded() { return grounded; }

/**
 * Shove the player with a one-off impulse - used for rocket-blast knockback.
 * `dir` is a (roughly unit) direction; `strength` is capped so a blast can't
 * fling the player across the map. A little upward pop is always added.
 */
function applyKnockback(dir, strength) {
  if (!playerBody) return;
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const s = Math.min(strength, 40);
  // Honour the rocket's actual direction, slope included; add only a small
  // fixed lift so a shoved player skims rather than ploughs along the floor.
  playerBody.applyImpulse(
    { x: (dir.x / len) * s, y: (dir.y / len) * s + s * 0.3, z: (dir.z / len) * s },
    true,
  );
  // Hand the body to physics briefly so the impulse isn't cancelled next frame.
  knockbackTimer = KNOCKBACK_RECOVERY;
}

/**
 * Recolor the local avatar - rebuilds the player mesh. Multiplayer calls this
 * so each player has a distinct, network-consistent color.
 */
function setPlayerColor(color) {
  playerColor = color;
  if (!playerMesh) return;
  const old = playerMesh;
  playerMesh = buildPlayerModel(color);
  playerMesh.position.copy(old.position);
  playerMesh.rotation.y = old.rotation.y;
  playerMesh.visible = old.visible;
  scene.add(playerMesh);
  scene.remove(old);
}

// --- Camera control object (v13+) ---
// Allows game code to switch modes and configure fixed camera.
const cameraControl = {
  get mode() { return cameraMode; },
  set mode(value) {
    if (['orbit', 'firstPerson', 'topDown', 'fixed'].includes(value)) {
      cameraMode = value;
    } else {
      console.warn(`[Player] Unknown camera mode: ${value}. Use: orbit, firstPerson, topDown, fixed`);
    }
  },
  get topDownHeight() { return TOP_DOWN_HEIGHT; },
  set topDownHeight(value) { TOP_DOWN_HEIGHT = value; },
  setFixedPosition(pos) { fixedCamPos = { ...pos }; },
  setFixedLookAt(pos) { fixedCamLookAt = { ...pos }; },
};

export {
  initPlayer,
  updatePlayer,
  getPosition,
  setPosition,
  getAimDirection,
  getAimOrigin,
  buildPlayerModel,
  animatePlayerModel,
  playerMesh,
  inputState,
  velocity,
  cameraControl,
  freezePlayer,
  unfreezePlayer,
  isFrozen,
  getPlayerColor,
  setPlayerColor,
  isGrounded,
  kickHitSprings,
  applyKnockback,
};
