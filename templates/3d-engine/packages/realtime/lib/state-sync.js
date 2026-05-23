/**
 * @gipity/realtime - Host transform sync
 *
 * Host-authoritative full + delta synchronization for an `entities` channel
 * with `authority:'host'`. The host serializes entity rows (full sync on
 * join/request, periodic delta with drift correction); non-hosts apply them.
 *
 * This is the high-frequency path for simulations (physics, games). Entity
 * create/delete + non-transform field changes ride a separate `entity-op`
 * relay handled by the channel (see entities.js).
 *
 * Row layout is opaque - the adapter's entities section owns it.
 */

import { getSettings } from './settings.js';
import { chunkInit, assembleChunks } from './protocol.js';

export function createStateSync({ name, transport, election, adapter, observability }) {
  const ent = adapter.entities;
  const M = (t) => `${name}:${t}`;

  let syncInterval = null;
  let keyframeInterval = null;
  const initChunks = new Map();
  let initReceived = false;
  let requested = false;
  const lastSentPos = new Map();
  const syncedCbs = new Set();

  function sendFullSync() {
    if (transport.getPeers().size === 0) return;
    const rows = [];
    for (const e of ent.list()) rows.push(ent.serializeFullRow(e));
    const chunks = chunkInit(rows, getSettings().chunkSize);
    for (const chunk of chunks) transport.send(M('sync'), chunk);
    observability.bump('syncFull');
    console.log(`[realtime] full sync sent: ${rows.length} entities, ${chunks.length} chunks`);
  }

  /**
   * Collect delta rows for all eligible entities.
   * @param {boolean} all - if true, ignore the deltaMoveThreshold and include
   *   every entity (a keyframe). If false, only entities that moved since the
   *   last send (the regular bandwidth-saving delta).
   *
   * Two modes, by whether the adapter supplies getDriftAnchor:
   *   - drift-tracked (physics): exclude anchored/resting entities, and on a
   *     delta skip ones that moved less than deltaMoveThreshold.
   *   - not tracked (non-spatial host state): every entity, every send.
   */
  function collectDeltaRows(all) {
    const s = getSettings();
    const rows = [];
    for (const e of ent.list()) {
      if (ent.tracksDrift) {
        const anchor = ent.getDriftAnchor(e);
        if (!anchor) continue; // adapter excludes this entity (anchored / no body)
        const id = ent.id(e);
        if (!all) {
          const last = lastSentPos.get(id);
          if (last) {
            const dx = Math.abs(anchor.x - last.x);
            const dy = Math.abs(anchor.y - last.y);
            const dz = Math.abs(anchor.z - last.z);
            if (dx < s.deltaMoveThreshold && dy < s.deltaMoveThreshold && dz < s.deltaMoveThreshold) continue;
          }
        }
        lastSentPos.set(id, { x: anchor.x, y: anchor.y, z: anchor.z });
      }
      rows.push(ent.serializeDeltaRow(e));
    }
    return rows;
  }

  function sendRows(rows) {
    if (rows.length === 0) return;
    const s = getSettings();
    for (let i = 0; i < rows.length; i += s.chunkSize) {
      transport.send(M('sync'), { kind: 'delta', rows: rows.slice(i, i + s.chunkSize) });
    }
    observability.bump('syncDelta');
  }

  /** Regular delta - only entities that moved since the last send. */
  function sendDeltaSync() {
    if (transport.getPeers().size === 0) return;
    sendRows(collectDeltaRows(false));
  }

  /**
   * Keyframe - re-broadcast every synced entity, resting ones included, so a
   * block that came to rest slightly off-position gets pulled back onto the
   * host's truth. Non-hosts snap resting bodies exactly (see the adapter's
   * applyDeltaRow); only loose/dynamic entities are ever sent, so this stays
   * cheap even with a large static world.
   */
  function sendKeyframe() {
    if (transport.getPeers().size === 0) return;
    sendRows(collectDeltaRows(true));
  }

  function startPeriodicSync() {
    stopPeriodicSync();
    const s = getSettings();
    // Either timer can be disabled with an interval of 0.
    if (s.syncIntervalMs > 0) {
      syncInterval = setInterval(sendDeltaSync, s.syncIntervalMs);
    }
    if (s.keyframeIntervalMs > 0) {
      keyframeInterval = setInterval(sendKeyframe, s.keyframeIntervalMs);
    }
  }
  function stopPeriodicSync() {
    if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
    if (keyframeInterval) { clearInterval(keyframeInterval); keyframeInterval = null; }
  }

  function applyInitSync(rows) {
    ent.clearAll();
    for (const row of rows) ent.applyFullRow(row);
    initReceived = true;
    requested = false;
    lastSentPos.clear();
    console.log(`[realtime] ✓ synced ${rows.length} entities from host`);
    for (const cb of syncedCbs) {
      try { cb(rows.length); } catch (e) { console.warn('[realtime] onSynced cb error', e); }
    }
  }

  function handleDelta(rows) {
    if (!initReceived) return;
    let maxDrift = 0;
    for (const row of rows) {
      if (!ent.get(row[0])) continue;
      const drift = ent.applyDeltaRow(row);
      if (drift > maxDrift) maxDrift = drift;
    }
    observability.set('lastMaxDrift', maxDrift);
  }

  function requestSync(force) {
    // After a host change, a previously-synced client must re-arm itself or
    // requestSync no-ops (initReceived stays true), the next applyInitSync
    // never runs, and any onSynced cbs (e.g. an "unfreeze player" callback)
    // never fire - the app gets stuck waiting for a sync that won't come.
    if (force) {
      initReceived = false;
      requested = false;
      lastSentPos.clear();
    }
    if (requested || initReceived) return;
    requested = true;
    transport.send(M('sync-request'), { sid: transport.getSessionId() });
  }

  function init() {
    initReceived = false;
    requested = false;
    lastSentPos.clear();

    transport.on(M('sync-request'), () => {
      if (election.isHost()) sendFullSync();
    });
    transport.on(M('sync'), (data) => {
      if (election.isHost()) return;
      if (data.kind === 'init') {
        const all = assembleChunks(data, initChunks);
        if (all) applyInitSync(all);
      } else if (data.kind === 'delta') {
        handleDelta(data.rows);
      }
    });
    transport.onDisconnect(() => stopPeriodicSync());
  }

  return {
    init,
    sendFullSync,
    sendDeltaSync,
    sendKeyframe,
    startPeriodicSync,
    stopPeriodicSync,
    requestSync,
    hasReceivedSync: () => initReceived,
    resetDirtyTracking: () => lastSentPos.clear(),
    /** Fires after a full world sync is applied (non-host). Use it to unfreeze. */
    onSynced(cb) {
      if (initReceived) cb(0);
      else syncedCbs.add(cb);
      return () => syncedCbs.delete(cb);
    },
  };
}
