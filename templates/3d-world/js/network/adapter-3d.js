/**
 * 3D World - realtime 3D adapter
 *
 * Bridges the engine-agnostic @gipity/realtime kit to this 3D template.
 * ALL 3D-specific knowledge lives here: quaternion rotation, Part
 * size/color/material/shape, and the Rapier physics body API.
 *
 * Capability-sectioned per the adapter contract
 * (src/packages/realtime/contracts/adapter.contract.md): a `presence` channel
 * uses `adapter.presence`; a `host` entities channel uses `adapter.entities`
 * + `adapter.authority`.
 */

import { getSettings } from '@gipity/realtime';

/**
 * @param {Object} deps
 * @param {Object} deps.player     Engine player module (getPosition, playerMesh).
 * @param {Object} deps.primitives Engine primitives module (Part workspace).
 */
export function create3DAdapter({ player, primitives }) {
  return {
    // ---- presence: local avatar -> {x,y,z,r} ----
    presence: {
      newPeer() {
        return { position: { x: 0, y: 0, z: 0 }, rotation: 0, color: null, grounded: true, mesh: null };
      },
      encode() {
        if (!player?.getPosition) return null;
        const p = player.getPosition();
        // `c` = this player's avatar color, so every client renders this
        // player the same hue (no per-screen mismatch). `g` = grounded flag
        // (1 bit) so peers can play the airborne pose without guessing.
        return {
          x: p.x, y: p.y, z: p.z,
          r: player.playerMesh?.rotation.y || 0,
          c: player.getPlayerColor?.(),
          g: player.isGrounded?.() ? 1 : 0,
        };
      },
      apply(peer, payload) {
        peer.position = { x: payload.x, y: payload.y, z: payload.z };
        peer.rotation = payload.r || 0;
        if (payload.c != null) peer.color = payload.c;
        // Default to grounded when the field is absent (older client).
        peer.grounded = payload.g !== 0;
      },
    },

    // ---- entities: Parts synced host-authoritatively ----
    // Part = { id, position, rotation(quat), size, anchored, color, material,
    //          shape, _body }.
    entities: {
      id: (part) => part.id,
      list: () => primitives.workspace.parts.values(),
      get: (id) => primitives.getPart(id),
      clearAll() {
        for (const part of primitives.getParts()) primitives.removePart(part);
      },

      serializeFullRow(part) {
        const body = part._body;
        const pos = body ? body.translation() : part.position;
        const rot = body ? body.rotation() : part.rotation;
        // Exact values, no quantization - a synced client should land on the
        // host's true transform, not a rounded grid.
        return [
          part.id,
          pos.x, pos.y, pos.z,
          rot.x, rot.y, rot.z, rot.w,
          part.size.x, part.size.y, part.size.z,
          part.anchored ? 1 : 0,
          part.color,
          part.material,
          part.shape || 'full',
          // Compound membership - so a synced client can rebuild the
          // destructible-block grouping and still shatter the red blocks.
          part._compoundId || '',
        ];
      },

      applyFullRow(row) {
        const [id, px, py, pz, rx, ry, rz, rw, sx, sy, sz, anchored, color, material, shape, compoundId] = row;
        const part = primitives.createPart({
          // Keep the host's id: delta + keyframe rows are keyed by it, so a
          // synced client must reuse it or every later correction is dropped.
          id,
          position: { x: px, y: py, z: pz },
          rotation: { x: rx, y: ry, z: rz, w: rw },
          size: { x: sx, y: sy, z: sz },
          anchored: anchored === 1,
          color, material, shape,
        });
        // Re-attach to its compound: the host sends compound sub-blocks as
        // flat Parts, so without this they arrive ungrouped and
        // breakCompoundsAt() can't shatter them on the joiner.
        if (compoundId && part) primitives.addPartToCompound(compoundId, part);
      },

      getDriftAnchor(part) {
        // Decide what's worth syncing. Two skips:
        //  1. An anchored sub-block of a STILL-INTACT compound - nothing freed
        //     anything there, so it's bit-identical on every client and can't
        //     have diverged.
        //  2. A block still in MOTION - flying debris is chaotic, looks worst
        //     when corrected mid-air, and doesn't matter. Only the SETTLED
        //     scene needs to match, so a dynamic block is synced once it has
        //     come to rest (the host's body is asleep).
        const body = part._body;
        if (part.anchored) {
          if (primitives.isInIntactCompound(part)) return null;
          return body ? body.translation() : part.position; // ground / disturbed survivor
        }
        if (!body || !body.isSleeping()) return null; // still moving - skip
        return body.translation();
      },

      serializeDeltaRow(part) {
        const body = part._body;
        const pos = body ? body.translation() : part.position;
        const rot = body ? body.rotation() : part.rotation;
        // Only settled blocks are sent (see getDriftAnchor), so no velocity -
        // a settled block's velocity is zero. Exact values, no quantization.
        return [
          part.id,
          pos.x, pos.y, pos.z,
          rot.x, rot.y, rot.z, rot.w,
          part.anchored ? 1 : 0,
        ];
      },

      applyDeltaRow(row) {
        const [id, px, py, pz, rx, ry, rz, rw, anchored] = row;
        const part = primitives.getPart(id);
        if (!part) return 0;
        const body = part._body;
        if (!body) return 0;

        // Anchored-state transition first (host broke or anchored the part).
        if ((anchored === 1) !== part.anchored) {
          primitives.setProperty(part, 'anchored', anchored === 1);
          // Host unanchored it (broke the compound) - drop our local compound
          // membership too, so a later local break doesn't re-free it.
          if (anchored !== 1) primitives.releaseFromCompound(part);
        }

        // Reconcile only once OUR copy has also come to rest. While it's still
        // settling, let local physics finish - snapping a mid-tumble block
        // makes the pile lurch in steps as the host's snapshots arrive.
        // (Anchored parts count as already at rest.)
        if (!part.anchored && !body.isSleeping()) return 0;

        const cur = body.translation();
        const dx = cur.x - px, dy = cur.y - py, dz = cur.z - pz;
        const drift = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Rotation drift: 1 - |dot| of the two quaternions (~0 = identical,
        // grows with the angle between them). A leaning/rocking block differs
        // mostly in rotation, so it must be checked - position drift alone
        // misses it. 0.0008 is roughly a 4-5 degree tilt.
        const cr = body.rotation();
        const dot = Math.abs(cr.x * rx + cr.y * ry + cr.z * rz + cr.w * rw);
        const rotDrift = 1 - Math.min(1, dot);

        // Every row here is a block the host considers settled. If ours is
        // meaningfully off in position OR rotation, snap it onto the host's
        // exact transform - WITHOUT waking it (correctPart freezes it), so the
        // joiner's settled stack matches the host's and stays calm. Waking it
        // would make the solver re-resolve the stack = the wobble.
        if (drift > getSettings().driftTolerance || rotDrift > 0.0008) {
          primitives.correctPart(part,
            { x: px, y: py, z: pz },
            { x: rx, y: ry, z: rz, w: rw });
        }
        return drift;
      },

      // CRUD relay hooks (entity-op): create/destroy a Part by id.
      remove(id) {
        const part = primitives.getPart(id);
        if (part) primitives.removePart(part);
      },
    },

    // ---- authority: this client's claim to host the world ----
    authority: {
      hasData: () => primitives.workspace.parts.size > 0,
      // The host owns the world - it plays immediately. A client that loses
      // host status re-freezes until it has re-synced from the new host.
      onBecomeHost: () => { console.log('[3d] hosting world state'); player.unfreezePlayer?.(); },
      onResign: () => { console.log('[3d] no longer host'); player.freezePlayer?.(); },
    },
  };
}
