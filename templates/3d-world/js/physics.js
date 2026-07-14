/**
 * 3D World - Physics Module
 * Rapier physics world and helpers.
 *
 * Exports: initPhysics(), world, addStaticBox, addDynamicBox, addTrigger, castRay, step
 */
import RAPIER from '@dimforge/rapier3d';

let world = null;
let rapier = null;
let eventQueue = null;
const triggers = new Map(); // collider handle → { onEnter, onExit }
const activeTriggers = new Set(); // currently-overlapping pairs: "handleA-handleB"

/** Initialize physics. Must be called (and awaited) before using other functions. */
async function initPhysics(gravity = { x: 0, y: -40, z: 0 }) {
  // rapier3d-compat requires init() to load WASM before use
  if (typeof RAPIER.init === 'function') {
    // Suppress Rapier's internal deprecation warning during WASM init (not actionable)
    const origWarn = console.warn;
    console.warn = (...args) => {
      if (typeof args[0] === 'string' && args[0].includes('deprecated parameters')) return;
      origWarn.apply(console, args);
    };
    await RAPIER.init();
    console.warn = origWarn;
  }
  rapier = RAPIER;
  world = new rapier.World(gravity);
  eventQueue = new rapier.EventQueue({ autoFlush: true });
  return world;
}

/** Create a static box collider (floors, walls, platforms) */
function addStaticBox(position, halfExtents) {
  const bodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = rapier.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
  const collider = world.createCollider(colliderDesc, body);
  return { body, collider };
}

/** Create a dynamic box (crates, balls, etc.) */
function addDynamicBox(position, halfExtents, mass = 1) {
  const bodyDesc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(position.x, position.y, position.z)
    .setCcdEnabled(true);
  const body = world.createRigidBody(bodyDesc);
  // Set density so total mass = requested mass (density = mass / volume)
  const volume = halfExtents.x * 2 * halfExtents.y * 2 * halfExtents.z * 2;
  const density = volume > 0 ? mass / volume : 1;
  const colliderDesc = rapier.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
    .setDensity(density);
  const collider = world.createCollider(colliderDesc, body);
  return { body, collider };
}

/** Create a kinematic character body (for player controller) */
function addKinematicBody(position, halfExtents) {
  const bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(position.x, position.y, position.z);
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = rapier.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
  const collider = world.createCollider(colliderDesc, body);
  return { body, collider };
}

/** Create a trigger zone (sensor). Callbacks: { onEnter(otherBody), onExit(otherBody) } */
function addTrigger(position, halfExtents, callbacks) {
  const bodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = rapier.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z).setSensor(true);
  const collider = world.createCollider(colliderDesc, body);
  triggers.set(collider.handle, callbacks);
  return { body, collider };
}

/** Remove a rigid body and its colliders */
function removeBody(body) {
  world.removeRigidBody(body);
}

/** Cast a ray. Returns { point, distance, collider } or null.
 *  excludeBody: optional RigidBody to ignore (e.g. the player's own body) */
function castRay(origin, direction, maxDistance = 100, excludeBody = null) {
  const ray = new rapier.Ray(origin, direction);
  let hit;
  try {
    if (excludeBody) {
      // Use predicate to filter out the player's own colliders
      const excludeHandle = excludeBody.handle;
      hit = world.castRay(ray, maxDistance, true, undefined, undefined, undefined, undefined,
        (collider) => collider.parent().handle !== excludeHandle
      );
    } else {
      hit = world.castRay(ray, maxDistance, true);
    }
  } catch (err) {
    // Fallback: cast without filter
    console.warn('[Physics] castRay filter failed, falling back:', err.message);
    hit = world.castRay(ray, maxDistance, true);
  }
  if (!hit) return null;
  const point = ray.pointAt(hit.timeOfImpact);
  return {
    point: { x: point.x, y: point.y, z: point.z },
    distance: hit.timeOfImpact,
    collider: hit.collider,
  };
}

/** Step physics and process trigger events */
function step(dt) {
  if (!world) return;
  world.timestep = Math.min(dt, 1 / 30);
  world.step(eventQueue);

  // Process collision events from the event queue
  if (eventQueue) {
    eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      for (const [handle, cbs] of [[handle1, triggers.get(handle1)], [handle2, triggers.get(handle2)]]) {
        if (!cbs) continue;
        const otherHandle = handle === handle1 ? handle2 : handle1;
        const pairKey = `${handle}-${otherHandle}`;
        if (started && !activeTriggers.has(pairKey)) {
          activeTriggers.add(pairKey);
          if (cbs.onEnter) {
            const otherCollider = world.getCollider(otherHandle);
            if (otherCollider) cbs.onEnter(otherCollider.parent());
          }
        }
      }
    });
  }
}

// --- Enhanced API for World Primitives (v13+) ---

/**
 * Create a rigid body with full options.
 * @param {Object} position - {x, y, z}
 * @param {Object} halfExtents - {x, y, z}
 * @param {Object} options
 * @param {'dynamic'|'fixed'|'kinematic'} options.type - Body type (default: 'dynamic')
 * @param {Object} options.rotation - Quaternion {x, y, z, w} (default: identity)
 * @param {number} options.mass - TOTAL body mass in kg (default: size-derived at density 1,
 *   e.g. a 2x2x2 box weighs 8). Pass a value to make the body weigh exactly that.
 * @param {number} options.friction - Collider friction (default: 0.5)
 * @param {number} options.restitution - Collider restitution/elasticity (default: 0.3)
 * @param {number} options.linearDamping - Linear velocity damping (default: 0.1)
 * @param {number} options.angularDamping - Angular velocity damping (default: 0.5)
 * @param {boolean} options.isSensor - If true, collider is a sensor (default: false)
 * @param {Float32Array} options.convexHullPoints - If set, use convex hull instead of cuboid
 */
function addBody(position, halfExtents, options = {}) {
  const type = options.type || 'dynamic';
  const rot = options.rotation || { x: 0, y: 0, z: 0, w: 1 };

  let bodyDesc;
  if (type === 'fixed') {
    bodyDesc = rapier.RigidBodyDesc.fixed();
  } else if (type === 'kinematic') {
    bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased();
  } else {
    bodyDesc = rapier.RigidBodyDesc.dynamic();
    bodyDesc.setCcdEnabled(true); // Prevent tunneling through other bodies
  }

  bodyDesc.setTranslation(position.x, position.y, position.z);
  bodyDesc.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });

  if (options.linearDamping !== undefined) bodyDesc.setLinearDamping(options.linearDamping);
  if (options.angularDamping !== undefined) bodyDesc.setAngularDamping(options.angularDamping);

  const body = world.createRigidBody(bodyDesc);

  let colliderDesc;
  if (options.convexHullPoints) {
    colliderDesc = rapier.ColliderDesc.convexHull(options.convexHullPoints);
    if (!colliderDesc) {
      // Fallback to cuboid if convex hull fails
      colliderDesc = rapier.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
    }
  } else {
    colliderDesc = rapier.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
  }

  if (options.friction !== undefined) colliderDesc.setFriction(options.friction);
  if (options.restitution !== undefined) colliderDesc.setRestitution(options.restitution);
  if (options.isSensor) colliderDesc.setSensor(true);
  // `mass` is the body's TOTAL mass. Setting it on the collider (not
  // setAdditionalMass on the body) replaces the density-derived mass and keeps
  // a shape-correct inertia tensor. Without this, `mass: 0.5` on a 2x2x2 box
  // silently produced an 8.5 kg body (8 from density 1 + 0.5 additional).
  if (type === 'dynamic' && options.mass !== undefined && options.mass !== null) {
    colliderDesc.setMass(options.mass);
  }

  const collider = world.createCollider(colliderDesc, body);
  return { body, collider };
}

/** Switch a body between dynamic, fixed, and kinematic at runtime */
function setBodyType(body, type) {
  if (type === 'fixed') {
    body.setBodyType(rapier.RigidBodyType.Fixed, true);
  } else if (type === 'kinematic') {
    body.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
  } else {
    body.setBodyType(rapier.RigidBodyType.Dynamic, true);
    // A body created 'fixed' carries no mass properties - Rapier only derives
    // them lazily on a later step. Recompute now so an impulse applied on this
    // same frame lands. Without it, a compound block freed + kicked by an
    // explosion ignores the kick and needs a *second* hit before it moves.
    body.recomputeMassPropertiesFromColliders();
  }
}

/** Update collider physical properties at runtime */
function setColliderProps(collider, props) {
  if (props.friction !== undefined) collider.setFriction(props.friction);
  if (props.restitution !== undefined) collider.setRestitution(props.restitution);
  if (props.isSensor !== undefined) collider.setSensor(props.isSensor);
}

/** Create a fixed (weld) joint between two bodies.
 *  frameA/frameB: {translation: {x,y,z}, rotation: {x,y,z,w}} relative to each body */
function addFixedJoint(bodyA, bodyB, frameA = {}, frameB = {}) {
  const tA = frameA.translation || { x: 0, y: 0, z: 0 };
  const rA = frameA.rotation || { x: 0, y: 0, z: 0, w: 1 };
  const tB = frameB.translation || { x: 0, y: 0, z: 0 };
  const rB = frameB.rotation || { x: 0, y: 0, z: 0, w: 1 };
  const data = rapier.JointData.fixed(tA, rA, tB, rB);
  return world.createImpulseJoint(data, bodyA, bodyB, true);
}

/** Create a revolute (hinge) joint between two bodies.
 *  anchor: {x,y,z} world-space pivot point
 *  axis: {x,y,z} rotation axis (normalized)
 *  limits: [minAngle, maxAngle] in radians (optional) */
function addRevoluteJoint(bodyA, bodyB, anchor, axis, limits) {
  // Convert world anchor to local frames
  const posA = bodyA.translation();
  const posB = bodyB.translation();
  const localA = { x: anchor.x - posA.x, y: anchor.y - posA.y, z: anchor.z - posA.z };
  const localB = { x: anchor.x - posB.x, y: anchor.y - posB.y, z: anchor.z - posB.z };
  const data = rapier.JointData.revolute(localA, localB, axis);
  if (limits) {
    data.limitsEnabled = true;
    data.limits = limits;
  }
  return world.createImpulseJoint(data, bodyA, bodyB, true);
}

/** Create a spring joint between two bodies.
 *  anchorA/anchorB: local-space anchor points on each body
 *  stiffness: spring constant, damping: damping coefficient, restLength: natural length */
function addSpringJoint(bodyA, bodyB, anchorA, anchorB, stiffness = 100, damping = 10, restLength = 1) {
  const data = rapier.JointData.spring(restLength, stiffness, damping, anchorA, anchorB);
  return world.createImpulseJoint(data, bodyA, bodyB, true);
}

/** Remove a joint from the physics world */
function removeJoint(joint) {
  world.removeImpulseJoint(joint, true);
}

/**
 * Apply an impulse to a body at a specific world-space point.
 * Rapier automatically computes the correct torque from the offset between
 * the point and the body's center of mass - so hits near the edge spin more.
 * @param {Object} body - Rapier RigidBody
 * @param {Object} impulse - {x, y, z} force vector
 * @param {Object} worldPoint - {x, y, z} world-space impact point
 */
function applyImpulseAtPoint(body, impulse, worldPoint) {
  body.applyImpulseAtPoint(impulse, worldPoint, true);
}

/**
 * Apply an impulse at the body's center of mass (no torque, pure translation).
 * @param {Object} body - Rapier RigidBody
 * @param {Object} impulse - {x, y, z} force vector
 */
function applyImpulse(body, impulse) {
  body.applyImpulse(impulse, true);
}

/** Query nearby colliders within radius of a position using broadphase.
 *  Returns array of { collider, body } */
function queryNearby(position, radius) {
  const results = [];
  const shape = new rapier.Ball(radius);
  const shapePos = { x: position.x, y: position.y, z: position.z };
  const shapeRot = { x: 0, y: 0, z: 0, w: 1 };
  world.intersectionsWithShape(shapePos, shapeRot, shape, (collider) => {
    const body = collider.parent();
    if (body) results.push({ collider, body });
    return true; // continue searching
  });
  return results;
}

export {
  initPhysics,
  world,
  addStaticBox,
  addDynamicBox,
  addKinematicBody,
  addTrigger,
  removeBody,
  castRay,
  step,
  rapier,
  eventQueue,
  // v13+ World Primitives API
  addBody,
  setBodyType,
  setColliderProps,
  addFixedJoint,
  addRevoluteJoint,
  addSpringJoint,
  removeJoint,
  queryNearby,
  applyImpulseAtPoint,
  applyImpulse,
};
