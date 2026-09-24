/**
 * @gipity/realtime - Entities channel
 *
 * Shared persistent records with CRUD. The `authority` option selects the
 * substrate:
 *   - 'server' / 'shared'  -> Colyseus State-room data map (server-persisted,
 *                             late-join-safe; any peer writes, last-write-wins)
 *   - 'host'               -> host election + transform delta sync (for
 *                             simulations) + an entity-op relay for CRUD
 *
 * Entity payloads are opaque - the adapter's entities section (de)serializes.
 */

import { createHostElection } from './host-election.js';
import { createStateSync } from './state-sync.js';

export function createEntitiesChannel({ name, authority, transport, adapter, observability }) {
  const ent = adapter.entities;
  const store = new Map();          // id -> record (server/shared mirror)
  const upsertCbs = new Set();
  const deleteCbs = new Set();
  const readyCbs = new Set();
  let readyFired = false;

  const fire = (set, ...a) => {
    for (const cb of set) {
      try { cb(...a); } catch (e) { console.warn('[realtime] entities cb error', e); }
    }
  };
  const fireReady = () => { if (!readyFired) { readyFired = true; fire(readyCbs); } };

  // ---------------- server / shared: data-map backed ----------------
  if (authority !== 'host') {
    const prefix = `${name}:`;

    transport.onData((key, value, prev) => {
      if (!key.startsWith(prefix)) return;
      const id = key.slice(prefix.length);
      if (value === undefined) {
        store.delete(id);
        ent.remove(id);
        fire(deleteCbs, id);
      } else {
        let decoded;
        try { decoded = ent.decode(JSON.parse(value)); }
        catch (e) { console.warn('[realtime] entity decode failed', key, e); return; }
        const prevRec = store.get(id);
        store.set(id, decoded);
        ent.apply(id, decoded, prevRec);
        fire(upsertCbs, id, decoded);
      }
    });

    return {
      sync: 'entities', name, authority,
      _afterConnect() { queueMicrotask(fireReady); },
      upsert(id, record) {
        store.set(id, record);
        transport.setData(prefix + id, JSON.stringify(ent.encode(record)));
      },
      delete(id) {
        store.delete(id);
        transport.deleteData(prefix + id);
      },
      get(id) { return store.get(id) ?? null; },
      all() { return store; },
      onUpsert(cb) { upsertCbs.add(cb); return () => upsertCbs.delete(cb); },
      onDelete(cb) { deleteCbs.add(cb); return () => deleteCbs.delete(cb); },
      onReady(cb) { if (readyFired) cb(); else readyCbs.add(cb); return () => readyCbs.delete(cb); },
      metrics() { return { entities: store.size, authority }; },
    };
  }

  // ---------------- host: election + transform sync + entity-op ----------------
  const election = createHostElection({ name, transport });
  const sync = createStateSync({ name, transport, election, adapter, observability });
  const opType = `${name}:entity-op`;
  const cmdType = `${name}:command`;
  const commandCbs = new Set();

  transport.on(opType, (msg) => {
    if (!msg || !msg.id) return;
    if (msg.op === 'delete') {
      ent.remove(msg.id);
      fire(deleteCbs, msg.id);
    } else {
      ent.apply(msg.id, msg.payload, ent.get(msg.id));
      fire(upsertCbs, msg.id, msg.payload);
    }
  });

  // Command relay - non-hosts send intents, only the host receives them.
  transport.on(cmdType, (msg) => {
    if (!msg || !election.isHost()) return;
    fire(commandCbs, msg.type, msg.data, msg.sid);
  });

  return {
    sync: 'entities', name, authority,
    async _afterConnect() {
      sync.init();
      const result = await election.init({
        hasWorldData: () => adapter.authority.hasData(),
        // Promoted to host (initial election or watchdog takeover) - start sending.
        onBecomeHost: () => { adapter.authority.onBecomeHost(); sync.startPeriodicSync(); },
        // Stepped down - stop sending, then pull the new host's world. Without
        // the requestSync a client that briefly self-elected then resigned
        // would sit frozen forever, having never asked for the real world.
        onResign: () => { adapter.authority.onResign(); sync.stopPeriodicSync(); sync.requestSync(true); },
      });
      if (result.isHost) sync.startPeriodicSync();
      else sync.requestSync();
      fireReady();
    },
    upsert(id, payload) {
      transport.send(opType, { op: 'upsert', id, payload });
      ent.apply(id, payload, ent.get(id));
    },
    delete(id) {
      transport.send(opType, { op: 'delete', id });
      ent.remove(id);
    },
    get(id) { return ent.get(id); },
    all() {
      const m = new Map();
      for (const e of ent.list()) m.set(ent.id(e), e);
      return m;
    },
    onUpsert(cb) { upsertCbs.add(cb); return () => upsertCbs.delete(cb); },
    onDelete(cb) { deleteCbs.add(cb); return () => deleteCbs.delete(cb); },
    onReady(cb) { if (readyFired) cb(); else readyCbs.add(cb); return () => readyCbs.delete(cb); },
    /** Non-host: fires when the host's full world sync lands. Host: never. */
    onSynced(cb) { return sync.onSynced(cb); },
    /** Non-host -> host intent relay. The host receives it via onCommand. */
    command(type, data = {}) {
      transport.send(cmdType, { type, data, sid: transport.getSessionId?.() || null });
    },
    /** Host-side: `cb(type, data, fromSid)` for each command from a non-host. */
    onCommand(cb) { commandCbs.add(cb); return () => commandCbs.delete(cb); },
    isHost: () => election.isHost(),
    hasReceivedSync: () => sync.hasReceivedSync(),
    sendFullSync: () => sync.sendFullSync(),
    metrics() { return { authority, isHost: election.isHost(), received: sync.hasReceivedSync() }; },
  };
}
