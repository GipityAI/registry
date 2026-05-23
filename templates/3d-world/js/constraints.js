/**
 * 3D World - Constraints Module
 * Roblox-style constraint types between Parts.
 *
 * Constraint types:
 *   - Weld: rigidly locks two parts (no relative movement)
 *   - Hinge: allows rotation around one axis (doors, wheels)
 *   - Spring: elastic connection (suspension, ropes)
 *
 * Exports: weld, hinge, spring, remove, getAll, removeAll
 */
import * as physics from './physics.js';

let nextConstraintId = 1;
const constraintRegistry = new Map(); // id → constraint object
const partConstraints = new Map();    // part id → Set of constraint ids

function generateId() {
  return `cst-${nextConstraintId++}`;
}

function registerConstraint(constraint, partA, partB) {
  constraintRegistry.set(constraint.id, constraint);
  for (const partId of [partA.id, partB.id]) {
    if (!partConstraints.has(partId)) partConstraints.set(partId, new Set());
    partConstraints.get(partId).add(constraint.id);
  }
  return constraint;
}

/**
 * Weld - rigidly locks two parts together. No relative movement allowed.
 * @param {Object} partA - First part (from primitives.createPart)
 * @param {Object} partB - Second part
 * @returns {Object} Constraint object with { id, type, partA, partB, joint }
 */
function weld(partA, partB) {
  if (!partA._body || !partB._body) {
    console.warn('[Constraints] Cannot weld: parts missing physics bodies');
    return null;
  }
  const joint = physics.addFixedJoint(partA._body, partB._body);
  return registerConstraint({
    id: generateId(),
    type: 'weld',
    partA,
    partB,
    joint,
  }, partA, partB);
}

/**
 * Hinge - allows rotation around one axis. Great for doors, wheels, levers.
 * @param {Object} partA - First part (usually anchored)
 * @param {Object} partB - Second part (the moving piece)
 * @param {Object} options
 * @param {Object} options.axis - Rotation axis {x, y, z} (default: {x:0, y:1, z:0} = vertical)
 * @param {Object} options.anchor - World-space pivot point (default: midpoint of the two parts)
 * @param {number[]} options.limits - [minAngle, maxAngle] in degrees (optional)
 * @returns {Object} Constraint object
 */
function hinge(partA, partB, options = {}) {
  if (!partA._body || !partB._body) {
    console.warn('[Constraints] Cannot hinge: parts missing physics bodies');
    return null;
  }

  const axis = options.axis || { x: 0, y: 1, z: 0 };
  // Normalize axis
  const len = Math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z);
  const normAxis = { x: axis.x / len, y: axis.y / len, z: axis.z / len };

  // Default anchor: midpoint between the two parts
  const anchor = options.anchor || {
    x: (partA.position.x + partB.position.x) / 2,
    y: (partA.position.y + partB.position.y) / 2,
    z: (partA.position.z + partB.position.z) / 2,
  };

  // Convert degree limits to radians
  const limits = options.limits
    ? [options.limits[0] * Math.PI / 180, options.limits[1] * Math.PI / 180]
    : null;

  const joint = physics.addRevoluteJoint(partA._body, partB._body, anchor, normAxis, limits);
  return registerConstraint({
    id: generateId(),
    type: 'hinge',
    partA,
    partB,
    joint,
    axis: normAxis,
    anchor,
  }, partA, partB);
}

/**
 * Spring - elastic connection between two parts. Great for suspension, ropes, bouncy things.
 * @param {Object} partA - First part
 * @param {Object} partB - Second part
 * @param {Object} options
 * @param {number} options.stiffness - Spring constant (default: 100)
 * @param {number} options.damping - Damping coefficient (default: 10)
 * @param {number} options.restLength - Natural length (default: distance between parts)
 * @returns {Object} Constraint object
 */
function spring(partA, partB, options = {}) {
  if (!partA._body || !partB._body) {
    console.warn('[Constraints] Cannot spring: parts missing physics bodies');
    return null;
  }

  const stiffness = options.stiffness ?? 100;
  const damping = options.damping ?? 10;

  // Default rest length: current distance between parts
  const dx = partB.position.x - partA.position.x;
  const dy = partB.position.y - partA.position.y;
  const dz = partB.position.z - partA.position.z;
  const restLength = options.restLength ?? Math.sqrt(dx * dx + dy * dy + dz * dz);

  const anchorA = { x: 0, y: 0, z: 0 }; // center of each part
  const anchorB = { x: 0, y: 0, z: 0 };

  const joint = physics.addSpringJoint(partA._body, partB._body, anchorA, anchorB, stiffness, damping, restLength);
  return registerConstraint({
    id: generateId(),
    type: 'spring',
    partA,
    partB,
    joint,
    stiffness,
    damping,
    restLength,
  }, partA, partB);
}

/** Remove a single constraint */
function remove(constraint) {
  if (!constraint || !constraintRegistry.has(constraint.id)) return;
  physics.removeJoint(constraint.joint);
  constraintRegistry.delete(constraint.id);
  for (const part of [constraint.partA, constraint.partB]) {
    const set = partConstraints.get(part.id);
    if (set) {
      set.delete(constraint.id);
      if (set.size === 0) partConstraints.delete(part.id);
    }
  }
}

/** Get all constraints attached to a part */
function getAll(part) {
  const ids = partConstraints.get(part.id);
  if (!ids) return [];
  return Array.from(ids).map(id => constraintRegistry.get(id)).filter(Boolean);
}

/** Remove all constraints attached to a part */
function removeAll(part) {
  const all = getAll(part);
  for (const c of all) remove(c);
}

export { weld, hinge, spring, remove, getAll, removeAll };
