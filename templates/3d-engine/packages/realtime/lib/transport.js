/**
 * @gipity/realtime - Transport (one per room)
 *
 * Owns a single Colyseus State-room connection and provides the substrates
 * that channels build on:
 *   1. custom messages   - send()/on()      (relay-style pub/sub)
 *   2. the data map      - setData()/onData() (server-persisted, late-join-safe)
 *   3. peer membership   - onPeerJoin/Leave  (from room.state.players)
 *
 * The Colyseus client and the app token are NOT owned here - they come from
 * the shared `client` (client.js), so many rooms share one socket factory and
 * one token. A `createRealtime()` opens one transport per room.
 *
 * Resilient: an unclean disconnect is recovered automatically via the Colyseus
 * reconnection token (the server holds a dropped seat for 30s), with
 * exponential backoff inside a settable window. The session id is preserved
 * across a reconnect, so channels and seats survive a network blip untouched.
 * Channel `onDisconnect` handlers fire only on a *permanent* loss, never on a
 * transient drop that is being recovered.
 *
 * Stub-safe: every method is callable before connect() (or with no app GUID,
 * i.e. offline mode) - sends become no-ops, queries return empty.
 */

import { applySettings, getSettings } from './settings.js';
import { reconnectDelay, isRoomGoneError } from './reconnect.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createTransport({ client, observability }) {
  let room = null;
  let connected = false;
  let reconnectionToken = null;
  let intentionalLeave = false;
  let reconnecting = false;
  let joinKind = null;       // 'create' | 'join' | 'reconnect'
  let awaitingSync = false;  // emit 'synced' on the next data-bearing patch
  let hasSynced = false;     // true once the room's first data patch has landed

  const peers = new Map();            // sid -> { lastSeen }
  const msgHandlers = new Map();      // type -> Set<cb>
  const dataHandlers = new Set();     // cb(key, value|undefined, prev)
  const peerJoinHandlers = new Set(); // cb(sid)
  const peerLeaveHandlers = new Set();// cb(sid)
  const disconnectHandlers = new Set();
  const dataMirror = new Map();       // key -> raw value string

  // --- internal dispatch ---

  function emitMsg(type, data) {
    const s = msgHandlers.get(type);
    if (s) for (const cb of s) {
      try { cb(data); } catch (e) { console.warn('[realtime] message handler error', e); }
    }
  }
  function fireData(key, value, prev) {
    for (const cb of dataHandlers) {
      try { cb(key, value, prev); } catch (e) { console.warn('[realtime] data handler error', e); }
    }
  }
  function firePeer(set, sid) {
    for (const cb of set) {
      try { cb(sid); } catch (e) { console.warn('[realtime] peer handler error', e); }
    }
  }
  function fireDisconnect(info) {
    for (const cb of disconnectHandlers) {
      try { cb(info); } catch { /* ignore */ }
    }
  }

  // --- connection ---

  /**
   * Join a room.
   * @param {Object} config
   * @param {string} [config.room]    Room name (default 'realtime-room').
   * @param {string} [config.roomId]  Instance id - required for mode 'joinById'.
   * @param {'joinOrCreate'|'create'|'joinById'} [config.mode]  Default 'joinOrCreate'.
   * @param {number} [config.maxClients]
   */
  async function connect(config = {}) {
    applySettings(config.settings);
    client.configure(config);
    intentionalLeave = false;
    const mode = config.mode || 'joinOrCreate';
    const roomName = config.room || 'realtime-room';

    try {
      const guid = client.getAppGuid();
      if (!guid) {
        console.debug('[realtime] No app GUID - offline mode');
        return null;
      }
      const token = await client.acquireToken();
      const colyseus = await client.colyseusClient();
      const opts = { app: guid, room: roomName, token, maxClients: config.maxClients || 50 };

      room = await joinWithRetry(() => {
        if (mode === 'create') return colyseus.create('state', opts);
        if (mode === 'joinById') return colyseus.joinById(config.roomId, opts);
        return colyseus.joinOrCreate('state', opts);
      });

      connected = true;
      joinKind = mode === 'create' ? 'create' : 'join';
      awaitingSync = true;
      hasSynced = false;
      console.log(`[realtime] ✓ Connected - sessionId=${room.sessionId} roomId=${room.roomId}`);
      observability.emit('connect', { sessionId: room.sessionId, roomId: room.roomId, room: roomName });
      wireRoom();
      return room;
    } catch (err) {
      console.warn('[realtime] Connection failed:', err.message);
      return null;
    }
  }

  /**
   * Run a join call with bounded retry. joinOrCreate can lose a seat to a
   * reservation race when an instance fills mid-join; a retry gets a fresh
   * seat. A "room gone" error is permanent - it fails fast, no retry.
   */
  async function joinWithRetry(fn) {
    const attempts = Math.max(1, getSettings().joinAttempts);
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (isRoomGoneError(err)) throw err;
        console.warn(`[realtime] join attempt ${i + 1}/${attempts} failed:`, err?.message);
        if (i < attempts - 1) await sleep(reconnectDelay(i + 1, { baseMs: 450, maxMs: 3000 }));
      }
    }
    throw lastErr;
  }

  function disconnect() {
    intentionalLeave = true;
    reconnecting = false;
    if (room) { try { room.leave(); } catch { /* already gone */ } }
    room = null;
    connected = false;
    peers.clear();
    dataMirror.clear();
  }

  // --- room wiring (players + data map + message relay) ---

  // Re-entrant: called on the initial join and again after every successful
  // reconnect. `knownPlayers` is seeded from the current peer set so a
  // post-reconnect state patch does not re-fire join for peers we already had.
  function wireRoom() {
    // Bind callbacks to THIS room object. The module-level `room` can be
    // reassigned by a reconnect or nulled by disconnect(); a trailing state
    // patch from a room we have since left must not deref a stale/null `room`.
    const r = room;
    reconnectionToken = r.reconnectionToken || reconnectionToken;
    const knownPlayers = new Set(peers.keys());

    // Colyseus 0.16 removed the per-collection .onAdd / .onChange / .onRemove
    // callbacks from schema instances - calling them throws "is not a function".
    // The robust, version-proof pattern is to diff the state ourselves:
    // onStateChange fires with the *full* state on every server patch. MapSchema
    // is also undefined on a fresh room, so each map is guarded before it is read.
    r.onStateChange((state) => {
      if (r !== room) return; // a stale patch from a room we have since left
      // Peer membership (server-authoritative).
      if (state.players) {
        const present = new Set();
        state.players.forEach((_, sid) => {
          present.add(sid);
          if (sid === r.sessionId || knownPlayers.has(sid)) return;
          knownPlayers.add(sid);
          peers.set(sid, { lastSeen: Date.now() });
          firePeer(peerJoinHandlers, sid);
        });
        for (const sid of [...knownPlayers]) {
          if (present.has(sid)) continue;
          knownPlayers.delete(sid);
          peers.delete(sid);
          firePeer(peerLeaveHandlers, sid);
        }
      }

      // Server-synced data map (entity substrate for shared/server channels).
      if (state.data) {
        const present = new Set();
        state.data.forEach((value, key) => {
          present.add(key);
          const prev = dataMirror.get(key);
          if (prev === value) return;       // unchanged since last patch
          dataMirror.set(key, value);
          fireData(key, value, prev);
        });
        for (const key of [...dataMirror.keys()]) {
          if (present.has(key)) continue;
          const prev = dataMirror.get(key);
          dataMirror.delete(key);
          fireData(key, undefined, prev);
        }
      }

      // First data-bearing patch after a (re)connect - the room is in sync.
      if (awaitingSync && state.data) {
        awaitingSync = false;
        hasSynced = true;
        observability.emit('synced', { kind: joinKind });
      }
    });

    // Custom-message relay - any unhandled type is broadcast app-to-app.
    r.onMessage('*', (type, data) => {
      if (r !== room) return; // ignore a stale message from a room we have left
      observability.bump('messagesReceived');
      if (data && data.sid && peers.has(data.sid)) {
        peers.get(data.sid).lastSeen = Date.now();
      }
      emitMsg(type, data);
    });

    r.onLeave((code) => {
      connected = false;
      if (intentionalLeave) {
        observability.emit('disconnect', { code });
        fireDisconnect({ code });
        return;
      }
      // Unclean drop - try to recover the session before giving up.
      startReconnect();
    });
    r.onError((code, message) => {
      connected = false;
      observability.emit('error', { code, message });
      console.error(`[realtime] ✗ Error (${code}): ${message}`);
    });
  }

  // --- reconnection ---

  // Recover an unclean disconnect via the Colyseus reconnection token, which
  // resumes the *same* session id. Backs off exponentially until the window
  // elapses; a permanent "room gone" failure stops early. Only a give-up
  // ('lost') fires channel disconnect handlers - a recovered blip never does.
  async function startReconnect() {
    if (reconnecting || intentionalLeave) return;
    const s = getSettings();
    if (s.reconnectWindowMs <= 0 || !reconnectionToken) {
      finishLost();
      return;
    }
    reconnecting = true;
    observability.emit('reconnecting', {});

    const colyseus = await client.colyseusClient();
    const deadline = Date.now() + s.reconnectWindowMs;
    let attempt = 0;
    while (Date.now() < deadline && !intentionalLeave) {
      attempt++;
      try {
        room = await colyseus.reconnect(reconnectionToken);
        connected = true;
        reconnecting = false;
        joinKind = 'reconnect';
        awaitingSync = true;
        hasSynced = false;
        observability.emit('reconnected', { sessionId: room.sessionId });
        console.log(`[realtime] ✓ Reconnected - sessionId=${room.sessionId}`);
        wireRoom();
        return;
      } catch (err) {
        if (isRoomGoneError(err)) break;
        await sleep(reconnectDelay(attempt, {
          baseMs: s.reconnectBaseDelayMs, maxMs: s.reconnectMaxDelayMs,
        }));
      }
    }
    reconnecting = false;
    if (!intentionalLeave) finishLost();
  }

  function finishLost() {
    connected = false;
    observability.emit('lost', {});
    console.warn('[realtime] ✗ Connection lost - could not reconnect');
    fireDisconnect({ code: 'lost' });
  }

  // --- messaging ---

  function send(type, data = {}) {
    if (!room || !connected) return;
    try {
      room.send(type, data);
      observability.bump('messagesSent');
    } catch (err) {
      console.error(`[realtime] send("${type}") failed:`, err.message);
      connected = false;
    }
  }

  function on(type, cb) {
    if (!msgHandlers.has(type)) msgHandlers.set(type, new Set());
    msgHandlers.get(type).add(cb);
    return () => msgHandlers.get(type)?.delete(cb);
  }

  // --- data map ---

  function setData(key, value) {
    if (!room || !connected) return;
    room.send('set_data', { key, value });
    observability.bump('dataWrites');
  }

  function deleteData(key) {
    if (!room || !connected) return;
    room.send('delete_data', { key });
    observability.bump('dataDeletes');
  }

  /** Subscribe to data-map changes. Existing keys are replayed immediately. */
  function onData(cb) {
    dataHandlers.add(cb);
    for (const [key, value] of dataMirror) {
      try { cb(key, value, undefined); } catch (e) { console.warn('[realtime] data replay error', e); }
    }
    return () => dataHandlers.delete(cb);
  }

  // --- peer events ---

  function onPeerJoin(cb) { peerJoinHandlers.add(cb); return () => peerJoinHandlers.delete(cb); }
  function onPeerLeave(cb) { peerLeaveHandlers.add(cb); return () => peerLeaveHandlers.delete(cb); }
  function onDisconnect(cb) { disconnectHandlers.add(cb); return () => disconnectHandlers.delete(cb); }

  // --- queries ---

  function isConnected() { return connected; }
  function isSynced() { return hasSynced; }
  function getRoomId() { return room?.roomId || null; }
  function getSessionId() { return room?.sessionId || null; }
  function getPeers() { return peers; }

  return {
    connect, disconnect, isConnected, isSynced, getRoomId, getSessionId, getPeers,
    send, on,
    setData, deleteData, onData,
    onPeerJoin, onPeerLeave, onDisconnect,
  };
}
