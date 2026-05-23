/**
 * @gipity/realtime - Store channel  (sync: 'store')
 *
 * A synchronous, whole-object key-value view of the room's data map. Where the
 * `entities` channel is async per-record CRUD with an adapter, `store` is the
 * plain shape a turn-based game, a match, or a lobby directory wants: set a
 * whole object under a key, read it back synchronously, react to changes.
 *
 * Backed by the Colyseus data map - server-persisted and late-join-safe, so a
 * peer that joins mid-game gets the current state immediately. Values are
 * JSON; the kit (de)serializes. No adapter needed.
 *
 * Authority:
 *   - 'shared' (default) - any peer writes; last-write-wins. Correct for
 *     turn-based games (only one peer writes at a time anyway).
 *   - 'host' - one elected host writes; non-hosts send command()s the host
 *     applies. For real-time games that need a referee.
 *
 * The server caps one data value at 10 KB. An oversize set() throws rather
 * than being silently dropped - split the value across keys if you hit it.
 */

import { createHostElection } from './host-election.js';

const VALUE_LIMIT = 10000; // server-side cap on a single data-map value

export function createStoreChannel({ name, transport, observability, authority = 'shared' }) {
  const prefix = `${name}:`;
  const cmdType = `${name}:command`;
  const hosted = authority === 'host';

  const mirror = new Map();   // key -> parsed value (server-confirmed)
  const changeCbs = new Set();
  const readyCbs = new Set();
  const commandCbs = new Set();
  const hostCbs = new Set();
  let readyFired = false;

  const election = hosted ? createHostElection({ name, transport }) : null;
  const isHost = () => (election ? election.isHost() : true);

  function fire(set, ...args) {
    for (const cb of set) {
      try { cb(...args); } catch (e) { console.warn('[realtime] store callback error', e); }
    }
  }

  // onReady fires once the room's first data sync has landed (the mirror is
  // populated) - NOT merely once connected. A store opened on a freshly joined
  // room must wait for that sync before get() reflects the room's real state.
  function fireReady() {
    if (readyFired) return;
    readyFired = true;
    for (const cb of readyCbs) { try { cb(); } catch { /* ignore */ } }
  }
  observability?.on?.('synced', fireReady);  // a sync that lands after we exist

  // Hydrate from the data map. transport.onData replays existing keys
  // immediately, so a channel opened after connect still sees current state.
  // The mirror reflects only server-confirmed state - writes are not applied
  // locally, which keeps get() faithful and the (key, value, prev) correct.
  transport.onData((fullKey, raw) => {
    if (!fullKey.startsWith(prefix)) return;
    const key = fullKey.slice(prefix.length);
    const prev = mirror.get(key);
    if (raw === undefined) {
      if (!mirror.has(key)) return;
      mirror.delete(key);
      fire(changeCbs, key, undefined, prev);
      return;
    }
    let value;
    try { value = JSON.parse(raw); }
    catch (e) { console.warn('[realtime] store value parse failed', fullKey, e); return; }
    mirror.set(key, value);
    fire(changeCbs, key, value, prev);
  });

  // Host-authoritative: commands flow non-host -> host.
  if (hosted) {
    transport.on(cmdType, (msg) => {
      if (!msg || !isHost()) return;
      fire(commandCbs, msg.type, msg.data, msg.sid);
    });
  }

  function guardWrite(op, key) {
    if (hosted && !isHost()) {
      console.warn(
        `[realtime] store "${name}" is host-authoritative - a non-host ${op}("${key}") ` +
        `was ignored. Send command() to the host instead.`,
      );
      return false;
    }
    return true;
  }

  function set(key, value) {
    if (!guardWrite('set', key)) return;
    const json = JSON.stringify(value);
    if (json.length > VALUE_LIMIT) {
      throw new Error(
        `[realtime] store value for "${name}:${key}" is ${json.length} bytes - over the ` +
        `${VALUE_LIMIT}-byte limit for one key. Split it across keys or use a smaller shape.`,
      );
    }
    transport.setData(prefix + key, json);
    observability?.bump?.('storeWrites');
  }

  function deleteKey(key) {
    if (!guardWrite('delete', key)) return;
    transport.deleteData(prefix + key);
  }

  const api = {
    sync: 'store', name, authority,

    _afterConnect() {
      if (election) {
        election.init({
          hasWorldData: () => mirror.size > 0,
          onBecomeHost: () => fire(hostCbs, true),
          onResign: () => fire(hostCbs, false),
        });
      }
      // Fire onReady now if the room's first sync already happened before this
      // channel was created (otherwise the 'synced' listener above catches it).
      if (transport.isSynced && transport.isSynced()) fireReady();
    },

    /** Synchronous read. Returns `fallback` when the key is unset. */
    get(key, fallback) { return mirror.has(key) ? mirror.get(key) : fallback; },
    has(key) { return mirror.has(key); },
    /** A fresh Map copy of every key. */
    all() { return new Map(mirror); },
    entries() { return [...mirror.entries()]; },
    keys() { return [...mirror.keys()]; },

    /** Write a whole value under `key`. Host-only when authority is 'host'. */
    set,
    /** Shallow-merge `patch` into the object at `key`. Returns the merged value. */
    update(key, patch) {
      const current = mirror.get(key);
      const base = (current && typeof current === 'object') ? current : {};
      const merged = { ...base, ...patch };
      set(key, merged);
      return merged;
    },
    delete: deleteKey,

    /** `cb(key, value, prev)` on every change. `value` is undefined on delete. */
    onChange(cb) { changeCbs.add(cb); return () => changeCbs.delete(cb); },
    onReady(cb) {
      if (readyFired) cb(); else readyCbs.add(cb);
      return () => readyCbs.delete(cb);
    },
    metrics() {
      return { keys: mirror.size, authority, ...(hosted ? { isHost: isHost() } : {}) };
    },
  };

  // Host-authority surface - only on a 'host' store.
  if (hosted) {
    api.isHost = isHost;
    /** Non-host -> host. The host receives it via onCommand. */
    api.command = (type, data = {}) => {
      transport.send(cmdType, { type, data, sid: transport.getSessionId?.() || null });
    };
    /** Host-side: `cb(type, data, fromSid)` for each command from a non-host. */
    api.onCommand = (cb) => { commandCbs.add(cb); return () => commandCbs.delete(cb); };
    /** `cb(isHost)` whenever this peer becomes / stops being the host. */
    api.onHost = (cb) => { hostCbs.add(cb); return () => hostCbs.delete(cb); };
  }

  return api;
}
