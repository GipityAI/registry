/**
 * 3D World - Rocket Launcher Feature
 * Opt-in projectile weapon with explosions and physics knockback.
 *
 * Enable in config.js:
 *   features: { 'rocket-launcher': true }
 *   features: { 'rocket-launcher': { speed: 200, cooldown: 1.0 } }
 */

export const DEFAULTS = {
  speed: 120,
  cooldown: 0.15,
  size: 2.0,
  color: 0xff4400,
  trailColor: 0xff8800,
  maxDistance: 150,
  blastRadius: 10,
  blastForce: 40,
  blastColor: 0xff6600,
  showCrosshair: true,
  debugKey: 'KeyB',
};

// A player avatar is ~2.8u wide and spans feet (-2.4) to hair (+2.6) from its
// mesh origin. Rockets are visual meshes with no collider, so a hit is a swept
// test of the rocket's travel segment against this upright capsule.
const AVATAR_HIT_RADIUS = 1.4;

/** True if the rocket segment p0->p1 passes through the avatar centred at A. */
function segmentHitsAvatar(p0, p1, A) {
  const dx = p1.x - p0.x, dz = p1.z - p0.z;
  const len2 = dx * dx + dz * dz;
  // Closest point on the segment to the avatar's vertical axis (in the XZ plane).
  let t = len2 > 1e-6 ? ((A.x - p0.x) * dx + (A.z - p0.z) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = p0.x + dx * t - A.x, cz = p0.z + dz * t - A.z;
  if (cx * cx + cz * cz > AVATAR_HIT_RADIUS * AVATAR_HIT_RADIUS) return false;
  const cy = p0.y + (p1.y - p0.y) * t - A.y;
  return cy > -2.6 && cy < 2.8;
}

/**
 * Distance along the ray O + D*s (D a unit vector) at which it passes through
 * the avatar centred at A, or Infinity if it never does. Used by aiming so the
 * crosshair locks onto a person instead of the wall behind them.
 */
function rayDistanceToAvatar(O, D, A) {
  const dl2 = D.x * D.x + D.z * D.z;
  if (dl2 < 1e-6) return Infinity; // ray near-vertical - no meaningful XZ approach
  const s = ((A.x - O.x) * D.x + (A.z - O.z) * D.z) / dl2;
  if (s <= 0) return Infinity;     // avatar is behind the camera
  const hx = O.x + D.x * s - A.x, hz = O.z + D.z * s - A.z;
  if (hx * hx + hz * hz > AVATAR_HIT_RADIUS * AVATAR_HIT_RADIUS) return Infinity;
  const hy = O.y + D.y * s - A.y;
  if (hy < -2.6 || hy > 2.8) return Infinity;
  return s;
}

export function create(config, deps) {
  const { world, scene, camera, physics, player, network, ui, assets, primitives, THREE } = deps;

  const rockets = [];
  const explosions = [];
  let cooldownTimer = 0;
  let debugMode = false;
  const debugLines = [];
  let rocketChannel = null;  // @gipity/realtime 'rocket' messages channel

  // Reused constants/temporaries - so the per-frame update loops below don't
  // allocate a THREE.Vector3 every rocket every frame.
  const UP_VECTOR = new THREE.Vector3(0, 1, 0);
  const tmpPrev = new THREE.Vector3();
  const tmpMove = new THREE.Vector3();

  // Event hooks
  const hooks = { fire: [], hit: [], explode: [] };
  function emit(type, ...args) { for (const cb of hooks[type]) cb(...args); }

  // --- Rocket mesh ---

  function buildRocketMesh() {
    const s = config.size;
    const group = new THREE.Group();

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.12 * s, 0.3 * s, 6),
      new THREE.MeshStandardMaterial({ color: 0xeeeeee }),
    );
    cone.position.y = 0.4 * s;
    group.add(cone);

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12 * s, 0.12 * s, 0.5 * s, 6),
      new THREE.MeshStandardMaterial({ color: config.color }),
    );
    body.position.y = 0.1 * s;
    group.add(body);

    const nozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08 * s, 0.14 * s, 0.16 * s, 6),
      new THREE.MeshStandardMaterial({ color: 0x444444 }),
    );
    nozzle.position.y = -0.22 * s;
    group.add(nozzle);

    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.1 * s, 0.3 * s, 6),
      new THREE.MeshBasicMaterial({ color: 0xffaa00 }),
    );
    flame.position.y = -0.46 * s;
    flame.rotation.x = Math.PI;
    group.add(flame);

    return group;
  }

  // --- Aiming ---

  function getAimTarget() {
    const camPos = camera.position.clone();
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);

    let bestDist = Infinity;
    let bestPoint = null;

    // Blocks / world geometry.
    const hit = physics.castRay(
      { x: camPos.x, y: camPos.y, z: camPos.z },
      { x: camDir.x, y: camDir.y, z: camDir.z },
      100,
    );
    if (hit) {
      bestPoint = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
      bestDist = bestPoint.distanceTo(camPos);
    }

    // Player avatars. The physics raycast misses them (not physics bodies), so
    // without this a peer standing in front of a wall is aimed straight past -
    // the crosshair sits on them but the rocket locks onto the wall behind.
    if (network.avatars?.peers) {
      for (const [, peer] of network.avatars.peers()) {
        if (!peer.position) continue;
        const s = rayDistanceToAvatar(camPos, camDir, peer.position);
        if (s < bestDist) {
          bestDist = s;
          bestPoint = new THREE.Vector3(
            camPos.x + camDir.x * s,
            camPos.y + camDir.y * s,
            camPos.z + camDir.z * s,
          );
        }
      }
    }

    if (bestPoint) return bestPoint;

    // Fallback: intersect ground plane y=0
    if (camDir.y !== 0) {
      const t = -camPos.y / camDir.y;
      if (t > 0) return new THREE.Vector3(camPos.x + camDir.x * t, 0, camPos.z + camDir.z * t);
    }

    return camPos.clone().add(camDir.multiplyScalar(100));
  }

  // --- Firing ---

  function fire() {
    if (cooldownTimer > 0) return;
    cooldownTimer = config.cooldown;

    const pos = player.getPosition();
    const chest = new THREE.Vector3(pos.x, pos.y + 1.0, pos.z);
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const target = getAimTarget();

    // Horizontal offset to clear the player model
    const horizDir = new THREE.Vector3(camDir.x, 0, camDir.z).normalize();
    const origin = chest.clone().add(horizDir.multiplyScalar(2));

    // Direction from spawn point to crosshair target. Either branch leaves
    // `dir` a unit vector (getWorldDirection returns one; the else normalizes).
    const dir = target.clone().sub(origin);
    if (dir.length() < 1) {
      camera.getWorldDirection(dir);
    } else {
      dir.normalize();
    }

    const mesh = buildRocketMesh();
    mesh.position.copy(origin);
    mesh.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(UP_VECTOR, dir));
    scene.add(mesh);

    rockets.push({
      mesh,
      direction: dir.clone(),
      distanceTraveled: 0,
      trailPoints: debugMode ? [origin.clone()] : null,
      trailLine: null,
    });

    // Multiplayer sync - broadcast on the 'rocket' channel
    rocketChannel?.send('fire', {
      x: origin.x, y: origin.y, z: origin.z,
      dx: dir.x, dy: dir.y, dz: dir.z,
    });

    emit('fire', origin, dir);
  }

  // --- Explosions ---

  // Apply + broadcast a hit on THIS client's local player, modelled physically.
  // `forceWorld` is the shove direction and `impactWorld` where it landed (both
  // world space). Both are converted into the player's local frame; the hit
  // springs then turn that into a torque (torso bend + body spin) and an arm
  // fling, and the same {F, r} is broadcast so peers reproduce it exactly.
  function reactPlayerHit(forceWorld, impactWorld, strength) {
    const pp = player.getPosition();
    const yaw = player.playerMesh?.rotation.y || 0;
    const cw = Math.cos(yaw), sw = Math.sin(yaw);
    // World vector -> player-local frame (x=right, y=up, z=forward).
    const toLocal = (wx, wy, wz) => ({ x: wx * cw - wz * sw, y: wy, z: wx * sw + wz * cw });
    const fl = Math.hypot(forceWorld.x, forceWorld.y, forceWorld.z) || 1;
    const F = toLocal(forceWorld.x / fl, forceWorld.y / fl, forceWorld.z / fl);
    const r = toLocal(impactWorld.x - pp.x, impactWorld.y - pp.y, impactWorld.z - pp.z);
    player.kickHitSprings?.(player.playerMesh, F, r);
    player.applyKnockback?.(forceWorld, strength);
    // Tell peers so they reproduce the same physical reaction on this avatar.
    const sid = network.rt?.getSessionId?.();
    if (sid) {
      rocketChannel?.send('hit', { sid, fx: F.x, fy: F.y, fz: F.z, ox: r.x, oy: r.y, oz: r.z });
    }
  }

  // `skipLocalSplash` is set when this explosion was already a direct hit on
  // the local player (updateRockets reacted it with the real impact point) -
  // so the splash check below doesn't react them a second time.
  function explodeAt(position, skipLocalSplash) {
    const { blastRadius, blastColor, blastForce } = config;

    // Expanding sphere
    const geo = new THREE.SphereGeometry(0.5, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: blastColor, transparent: true, opacity: 0.9 });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.position.copy(position);
    scene.add(sphere);
    explosions.push({ mesh: sphere, age: 0 });

    // Particle debris
    for (let i = 0; i < 12; i++) {
      const particle = assets.createVoxelBox(blastColor, 0.2);
      particle.position.copy(position);
      scene.add(particle);
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 1.5,
        (Math.random() - 0.5) * 2,
      ).normalize();
      explosions.push({
        mesh: particle, age: 0, isParticle: true,
        velocity: dir.multiplyScalar(8 + Math.random() * 6),
      });
    }

    // Free compound blocks in the blast radius. Force is 0 here on purpose:
    // this call ONLY unanchors the sub-blocks (turns them dynamic). The
    // single blast-impulse pass below is the one source of force - it then
    // kicks every dynamic body in range uniformly. So one rocket = one
    // explosion = exactly one impulse per body, and a freed red block
    // behaves identically to a plain block of the same mass.
    if (primitives) {
      primitives.breakCompoundsAt(
        { x: position.x, y: position.y, z: position.z },
        blastRadius,
        0,
      );
    }

    // Blast impulse + torque to all dynamic bodies in radius
    const nearby = physics.queryNearby(
      { x: position.x, y: position.y, z: position.z },
      blastRadius,
    );
    for (const { body } of nearby) {
      if (!body.isDynamic()) continue;
      const bp = body.translation();
      const dx = bp.x - position.x;
      const dy = bp.y - position.y;
      const dz = bp.z - position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > blastRadius || dist < 0.01) continue;

      const falloff = 1 - dist / blastRadius;
      const strength = blastForce * falloff;
      const blastDir = new THREE.Vector3(dx / dist, dy / dist, dz / dist);

      body.wakeUp();

      // Impulse away from blast + upward kick
      const impulse = blastDir.clone().multiplyScalar(strength);
      impulse.y += strength * 0.5;
      body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);

      // Torque: cross product for realistic off-center spin
      const offset = new THREE.Vector3(
        position.x - bp.x, position.y - bp.y, position.z - bp.z,
      ).normalize();
      const torque = new THREE.Vector3().crossVectors(offset, blastDir).multiplyScalar(strength * 0.4);
      body.applyTorqueImpulse({ x: torque.x, y: torque.y, z: torque.z }, true);
    }

    // Splash hit: the local player caught in the blast radius. (A direct hit
    // is reacted in updateRockets with the real impact point, and sets
    // skipLocalSplash so we don't react them twice.) Avatars aren't physics
    // bodies, so the block-impulse loop above never touches them.
    if (!skipLocalSplash) {
      const pp = player.getPosition();
      const dx = pp.x - position.x;
      const dy = (pp.y + 0.4) - position.y;
      const dz = pp.z - position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < blastRadius && dist > 0.01) {
        const hd = Math.hypot(dx, dz) || 1;
        // Shove away from the blast; the "impact" lands on the body's
        // blast-facing side at torso height.
        const forceWorld = { x: dx / hd, y: 0.3, z: dz / hd };
        const impactWorld = { x: pp.x - dx / hd, y: pp.y + 0.4, z: pp.z - dz / hd };
        reactPlayerHit(forceWorld, impactWorld, blastForce * (1 - dist / blastRadius));
      }
    }

    emit('explode', position);
  }

  // --- Debug ---

  function drawDebugLine(from, to, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    debugLines.push(line);
  }

  function clearDebugLines() {
    for (const line of debugLines) scene.remove(line);
    debugLines.length = 0;
  }

  // --- Update loops ---

  function updateRockets(dt) {
    const { speed, maxDistance } = config;

    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      const prev = tmpPrev.copy(r.mesh.position);          // this frame's start point
      r.mesh.position.add(tmpMove.copy(r.direction).multiplyScalar(speed * dt));
      r.distanceTraveled += speed * dt;

      // Debug trail
      if (r.trailPoints) {
        r.trailPoints.push(r.mesh.position.clone());
        if (r.trailLine) {
          scene.remove(r.trailLine);
          const idx = debugLines.indexOf(r.trailLine);
          if (idx !== -1) debugLines.splice(idx, 1);
        }
        const geo = new THREE.BufferGeometry().setFromPoints(r.trailPoints);
        r.trailLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffff00 }));
        scene.add(r.trailLine);
        debugLines.push(r.trailLine);
      }

      // --- Collision ---
      let hit = false;
      let localDirect = false;  // true when this rocket directly struck the local player
      const rp = r.mesh.position;

      // Player avatars first - a swept test of this frame's travel segment, so
      // a fast rocket can't tunnel through someone. Skip the local player for
      // the first few units so a rocket can't detonate on the shooter's muzzle.
      if (r.distanceTraveled > 3 && segmentHitsAvatar(prev, rp, player.getPosition())) {
        hit = true;
        localDirect = true;
      }
      if (!hit && network.avatars?.peers) {
        for (const [, peer] of network.avatars.peers()) {
          if (peer.position && segmentHitsAvatar(prev, rp, peer.position)) { hit = true; break; }
        }
      }
      // World bodies: blocks (fixed) + loose dynamic parts.
      if (!hit) {
        const nearby = physics.queryNearby({ x: rp.x, y: rp.y, z: rp.z }, 0.5);
        for (const { body } of nearby) {
          if (body.isFixed() || body.isDynamic()) { hit = true; break; }
        }
      }

      // Ground hit
      if (!hit && rp.y <= 0.2) hit = true;

      if (hit || r.distanceTraveled > maxDistance) {
        if (hit) {
          // Direct hit on the local player: react with the real impact point
          // (rocket direction + where it struck) so the torque is physical.
          if (localDirect) reactPlayerHit(r.direction, rp, config.blastForce * 0.9);
          explodeAt(rp.clone(), localDirect);
          emit('hit', rp.clone());
        }
        scene.remove(r.mesh);
        rockets.splice(i, 1);
      }
    }
  }

  function updateExplosions(dt) {
    for (let i = explosions.length - 1; i >= 0; i--) {
      const e = explosions[i];
      e.age += dt;

      if (e.isParticle) {
        e.mesh.position.add(tmpMove.copy(e.velocity).multiplyScalar(dt));
        e.velocity.y -= 15 * dt;
        const life = 0.6;
        e.mesh.scale.setScalar(Math.max(0, 1 - e.age / life));
        if (e.age > life) { scene.remove(e.mesh); explosions.splice(i, 1); }
      } else {
        const life = 0.4;
        const t = e.age / life;
        e.mesh.scale.setScalar(1 + t * config.blastRadius * 2);
        e.mesh.material.opacity = Math.max(0, 0.9 * (1 - t));
        if (e.age > life) { scene.remove(e.mesh); explosions.splice(i, 1); }
      }
    }
  }

  // --- Input handlers ---

  let mouseHeld = false;
  function onMouseDown(e) { if (e.button === 0) mouseHeld = true; }
  function onMouseUp(e) { if (e.button === 0) mouseHeld = false; }
  function onKeyDown(e) {
    // Ignore keys typed into form fields (name entry, chat) - the debug
    // toggle must not fire while the user is typing.
    if (e.target instanceof Element && (e.target.closest('input, textarea, select') !== null || e.target.isContentEditable)) return;
    if (e.code === config.debugKey) {
      debugMode = !debugMode;
      if (!debugMode) clearDebugLines();
      console.log(`[Rocket debug] ${debugMode ? 'ON' : 'OFF'}`);
    }
  }

  // --- Network handlers ---

  function spawnRemoteRocket(x, y, z, dx, dy, dz) {
    const mesh = buildRocketMesh();
    mesh.position.set(x, y, z);
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    mesh.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(UP_VECTOR, dir));
    scene.add(mesh);
    rockets.push({ mesh, direction: dir, distanceTraveled: 0, trailPoints: null, trailLine: null });
  }

  // --- Public API ---

  return {
    config,

    async init() {
      // Input
      document.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mouseup', onMouseUp);
      window.addEventListener('keydown', onKeyDown);

      // Crosshair
      if (config.showCrosshair) {
        ui.setHud('center', '<div style="font-size:36px;color:rgba(255,255,255,0.7);pointer-events:none">+</div>');
      }

      // Multiplayer: receive remote rockets via the 'rocket' channel
      rocketChannel = network.channel('rocket', { sync: 'messages' });
      rocketChannel.on('fire', (data) => {
        spawnRemoteRocket(data.x, data.y, data.z, data.dx, data.dy, data.dz);
      });
    },

    update(dt) {
      if (cooldownTimer > 0) cooldownTimer -= dt;

      // Fire on held mouse click, or the mobile Action button (inputState.action)
      if ((mouseHeld || player.inputState.action) && cooldownTimer <= 0) fire();

      updateRockets(dt);
      updateExplosions(dt);
    },

    destroy() {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      // Clean up scene objects
      for (const r of rockets) scene.remove(r.mesh);
      for (const e of explosions) scene.remove(e.mesh);
      clearDebugLines();
      rockets.length = 0;
      explosions.length = 0;
      if (config.showCrosshair) ui.clearHud('center');
    },

    fire,

    onFire(cb) { hooks.fire.push(cb); },
    onHit(cb) { hooks.hit.push(cb); },
    onExplode(cb) { hooks.explode.push(cb); },
  };
}
