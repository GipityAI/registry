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
 * Seat resume across a page reload: the current reconnection token is kept in
 * localStorage per (app, room, scope) and cleared on every clean leave. When a
 * page died WITHOUT a clean leave (a crash, a killed tab), the server is still
 * holding its seat; the next join of that room from this browser presents the
 * token first and takes the held seat back - same session id, same host role -
 * instead of being refused as 'full' by its own ghost. mode 'resume' does only
 * that and never takes a new seat.
 *
 * Stub-safe: every method is callable before connect() (or with no app GUID,
 * i.e. offline mode) - sends become no-ops, queries return empty.
 *
 * Server envelope: every custom message arrives stamped with `senderId` and
 * `serverTs` by the server (client values are overwritten, so both are
 * trustworthy). send(type, data, { to }) targets one session id, a list, or
 * 'host'; a targeted send that reached nobody comes back as `__undelivered`
 * and is surfaced as the 'undelivered' event. The host role is server-side
 * and opt-in (connect({ host: true })): its reclaim key is kept in
 * sessionStorage per (app, room, scope) so a reloaded host page takes the role
 * back, whichever join mode it uses. A periodic `__ping` keeps an estimate of
 * the server clock.
 */

import { applySettings, getSettings } from './settings.js';
import { reconnectDelay, isRoomGoneError } from './reconnect.js';
import { classifyJoinError, RealtimeJoinError } from './errors.js';
import { createClock } from './clock.js';
import { readStored, writeStored, deviceClientId } from './storage.js';

/** Server-internal message types: handled here, never emitted to the app. */
const INTERNAL = new Set(['__pong', '__host', '__host_key', '__undelivered']);
// Both stores hold JSON { roomId, ... } under one key per (app, room, scope),
// so a join that doesn't know the instance id yet (joinOrCreate) finds them.
const hostKeyStorageKey = (guid, room, scope) => `gipity-rt:host-key:${guid}:${room}:${scope}`;
const seatStorageKey = (guid, room, scope) => `gipity-rt:seat:${guid}:${room}:${scope}`;

function readJson(kind, key) {
  try { return JSON.parse(readStored(kind, key) || 'null'); } catch { return null; }
}
/** A stored { roomId, ... } record, when it applies to `roomId` (any
 *  instance when the join doesn't name one). */
function storedFor(kind, key, roomId) {
  const rec = readJson(kind, key);
  if (!rec?.roomId) return null;
  return !roomId || rec.roomId === roomId ? rec : null;
}

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
  let lastError = null;      // why the most recent connect() returned null
  let connectConfig = {};    // the last connect() config (room name, host flag)
  let hostId = null;         // session id of the room's host, null when none
  let pingTimer = null;
  const clock = createClock();

  const peers = new Map();            // sid -> { lastSeen, clientId, displayName }
  const hostChangeHandlers = new Set(); // cb(hostId|null, isMe)
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
  function setHost(id) {
    const next = id || null;
    if (next === hostId) return;
    hostId = next;
    const me = !!room && hostId === room.sessionId;
    for (const cb of hostChangeHandlers) {
      try { cb(hostId, me); } catch (e) { console.warn('[realtime] host handler error', e); }
    }
    observability.emit('host', { hostId, isMe: me });
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
   * @param {string} [config.scope]   Instance partition key. Same (room, scope)
   *                                  -> same instance; different scope -> a
   *                                  separate instance of the same provisioned
   *                                  room. Use for URL/invite-code partitioning
   *                                  without provisioning a room per value.
   * @param {string} [config.roomId]  Instance id - required for mode 'joinById'.
   * @param {'joinOrCreate'|'join'|'create'|'joinById'|'resume'} [config.mode]
   *                                  Default 'joinOrCreate'. 'join' never
   *                                  creates - it fails with 'not-found' when
   *                                  no matching instance is live. 'resume'
   *                                  only takes back a seat this browser left
   *                                  uncleanly (else 'not-found'). Every mode
   *                                  but 'create' tries that resume first.
   * @param {number} [config.maxClients]
   * @returns {Promise<Object|null>}  The Colyseus room, or null on failure
   *                                  (inspect getLastError() / the 'error'
   *                                  observability event for the cause).
   */
  async function connect(config = {}) {
    applySettings(config.settings);
    client.configure(config);
    intentionalLeave = false;
    lastError = null;
    const mode = config.mode || 'joinOrCreate';
    const roomName = config.room || 'realtime-room';
    const scope = String(config.scope ?? '');

    try {
      const guid = client.getAppGuid();
      if (!guid) {
        console.debug('[realtime] No app GUID - offline mode');
        return null;
      }
      const token = await client.acquireToken();
      const colyseus = await client.colyseusClient();
      const opts = { app: guid, room: roomName, scope, token, maxClients: config.maxClients || 50 };
      // Rooms provisioned auth_level:'user' verify a Gipity session server-side;
      // without this pass-through the kit simply could not join them (the server
      // rejects with "requires Gipity login" and there was no way to comply).
      if (config.sessionId) opts.sessionId = config.sessionId;
      if (config.displayName) opts.displayName = config.displayName;
      opts.clientId = config.clientId || deviceClientId();
      if (config.host) {
        opts.host = true;
        // A key from an earlier page load of this host reclaims the role.
        const key = config.hostKey
          || storedFor('sessionStorage', hostKeyStorageKey(guid, roomName, scope), config.roomId)?.key;
        if (key) opts.hostKey = key;
      }
      connectConfig = { ...config, room: roomName, scope };

      // A seat this browser left without a clean leave is still held by the
      // server: take it back before asking for a new one (which the held seat
      // itself may be blocking when the room is at max_clients).
      const resumed = mode === 'create' ? null : await resumeSeat(colyseus, guid, roomName, scope, config.roomId);
      if (!resumed && mode === 'resume') {
        throw new RealtimeJoinError('not-found', `no held seat to resume in '${roomName}'`);
      }
      room = resumed || await joinWithRetry(() => {
        if (mode === 'create') return colyseus.create('state', opts);
        if (mode === 'join') return colyseus.join('state', opts);
        if (mode === 'joinById') return colyseus.joinById(config.roomId, opts);
        return colyseus.joinOrCreate('state', opts);
      });

      connected = true;
      joinKind = resumed ? 'reconnect' : mode === 'create' ? 'create' : 'join';
      awaitingSync = true;
      hasSynced = false;
      console.log(`[realtime] ✓ ${resumed ? 'Resumed held seat' : 'Connected'} - sessionId=${room.sessionId} roomId=${room.roomId}`);
      observability.emit('connect', { sessionId: room.sessionId, roomId: room.roomId, room: roomName, resumed: !!resumed });
      wireRoom();
      bindPagehide();
      startClockSync();
      return room;
    } catch (err) {
      lastError = err;
      console.warn('[realtime] Connection failed:', err.message);
      observability.emit('error', { phase: 'connect', message: err.message, error: err });
      return null;
    }
  }

  /**
   * Present a stored reconnection token for (room, scope) - and, when the
   * join names an instance, only that instance's. Resolves the resumed room,
   * or null. A token whose room is gone is dropped; any other failure (the
   * server hasn't noticed the old socket died yet, so the seat isn't held
   * yet) keeps it for the next attempt. One failed request is the cost, and
   * only after an unclean exit: every clean leave clears the token.
   */
  async function resumeSeat(colyseus, guid, roomName, scope, roomId) {
    const key = seatStorageKey(guid, roomName, scope);
    const rec = storedFor('localStorage', key, roomId);
    if (!rec?.token) return null;
    try {
      return await colyseus.reconnect(rec.token);
    } catch (err) {
      if (isRoomGoneError(err)) writeStored('localStorage', key, null);
      console.debug('[realtime] no held seat to resume:', err?.message);
      return null;
    }
  }

  function rememberSeat(r) {
    if (!r?.reconnectionToken) return;
    writeStored('localStorage', seatStorageKey(client.getAppGuid(), connectConfig.room, connectConfig.scope ?? ''),
      JSON.stringify({ roomId: r.roomId, token: r.reconnectionToken }));
  }

  function forgetSeat(roomId) {
    const key = seatStorageKey(client.getAppGuid(), connectConfig.room, connectConfig.scope ?? '');
    if (roomId && readJson('localStorage', key)?.roomId === roomId) writeStored('localStorage', key, null);
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
        // A rejection that can never succeed on retry (bad/expired auth, an
        // unprovisioned room name, join-only found nothing) must fail fast -
        // retrying used to burn the full backoff window (~6s) on every one.
        const kind = classifyJoinError(err);
        if (kind === 'auth' || kind === 'unprovisioned' || kind === 'not-found') throw err;
        // A full scoped table (an invite code) won't free up by retrying.
        if (kind === 'full' && /scope is full/i.test(String(err?.message || ''))) throw err;
        console.warn(`[realtime] join attempt ${i + 1}/${attempts} failed:`, err?.message);
        if (i < attempts - 1) await sleep(reconnectDelay(i + 1, { baseMs: 450, maxMs: 3000 }));
      }
    }
    throw lastErr;
  }

  function disconnect() {
    intentionalLeave = true;
    reconnecting = false;
    stopClockSync();
    if (room) forgetSeat(room.roomId);   // a clean leave frees the seat: nothing to resume
    if (room) { try { room.leave(); } catch { /* already gone */ } }
    room = null;
    connected = false;
    peers.clear();
    dataMirror.clear();
  }

  // When the page dies (navigation, tab close), leave CONSENTED so the server
  // frees this seat immediately. A raw WebSocket drop reads as unclean and the
  // server holds the seat 30 s for a reconnection that can never come - which
  // shows up as "table is full" for the next joiner and as ghost peers in
  // rosters. (A bfcache-restored page comes back disconnected - acceptable for
  // a realtime session that was dead the moment the page was hidden.)
  let pagehideBound = false;
  function bindPagehide() {
    if (pagehideBound || typeof window === 'undefined') return;
    pagehideBound = true;
    window.addEventListener('pagehide', () => { if (connected) disconnect(); });
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
    rememberSeat(r);
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
        state.players.forEach((player, sid) => {
          present.add(sid);
          if (sid === r.sessionId) return;
          const known = knownPlayers.has(sid);
          const info = peers.get(sid) || { lastSeen: Date.now() };
          info.clientId = player?.clientId || '';
          info.displayName = player?.displayName || '';
          peers.set(sid, info);
          if (known) return;
          knownPlayers.add(sid);
          firePeer(peerJoinHandlers, sid);
        });
        for (const sid of [...knownPlayers]) {
          if (present.has(sid)) continue;
          knownPlayers.delete(sid);
          peers.delete(sid);
          firePeer(peerLeaveHandlers, sid);
        }
      }

      if (typeof state.hostId === 'string') setHost(state.hostId);

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
      if (INTERNAL.has(type)) { handleInternal(r, type, data); return; }
      observability.bump('messagesReceived');
      // Identity comes from the server, never the payload: the server stamps
      // senderId on every relayed message (overwriting whatever the client
      // put there), and every kit module keys on `sid`, so align the two here.
      if (data && typeof data === 'object' && typeof data.senderId === 'string') data.sid = data.senderId;
      if (data && data.sid && peers.has(data.sid)) {
        peers.get(data.sid).lastSeen = Date.now();
      }
      emitMsg(type, data);
    });

    r.onLeave((code) => {
      connected = false;
      stopClockSync();
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
    const windowMs = connectConfig.host && room && hostId === room.sessionId
      ? Math.max(s.reconnectWindowMs, s.hostReconnectWindowMs)
      : s.reconnectWindowMs;
    if (windowMs <= 0 || !reconnectionToken) {
      finishLost();
      return;
    }
    reconnecting = true;
    observability.emit('reconnecting', {});

    const colyseus = await client.colyseusClient();
    const deadline = Date.now() + windowMs;
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
        startClockSync();
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
    if (room) forgetSeat(room.roomId);
    observability.emit('lost', {});
    console.warn('[realtime] ✗ Connection lost - could not reconnect');
    fireDisconnect({ code: 'lost' });
  }

  // --- messaging ---

  /**
   * Send a custom message. `opts.to`: a session id, an array of them, or
   * 'host'; omitted = everyone else in the room.
   */
  function send(type, data = {}, opts = {}) {
    if (!room || !connected) return;
    try {
      const payload = opts.to === undefined ? data
        : { ...(typeof data === 'object' && data !== null && !Array.isArray(data) ? data : { data }), __to: opts.to };
      room.send(type, payload);
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

  // --- internal messages: host role + clock ---

  function handleInternal(r, type, data) {
    if (type === '__pong') {
      clock.addSample(data?.t, data?.serverTs, Date.now());
      return;
    }
    if (type === '__host_key') {
      if (typeof data?.key === 'string') {
        writeStored('sessionStorage', hostKeyStorageKey(client.getAppGuid(), connectConfig.room, connectConfig.scope ?? ''),
          JSON.stringify({ roomId: r.roomId, key: data.key }));
      }
      return;
    }
    if (type === '__undelivered') {
      // A targeted send reached nobody: 'no-host' (sendToHost / to:'host'
      // while no host is connected) or 'no-recipient'. Split the wire type
      // back into the channel name and the app's message type.
      const wire = String(data?.type ?? '');
      const i = wire.indexOf(':');
      observability.bump('undelivered');
      observability.emit('undelivered', {
        channel: i > 0 ? wire.slice(0, i) : null,
        type: i > 0 ? wire.slice(i + 1) : wire,
        to: data?.to ?? null,
        reason: data?.reason || 'no-recipient',
      });
      return;
    }
    if (type === '__host') setHost(data?.hostId);
  }

  function ping() {
    if (!room || !connected) return;
    try { room.send('__ping', { t: Date.now() }); } catch { /* reconnect handles it */ }
  }

  // A burst of pings on (re)connect gives a good first estimate; then a slow
  // refresh keeps the estimate current as network conditions drift.
  function startClockSync() {
    stopClockSync();
    const every = getSettings().clockSyncMs;
    if (every <= 0) return;
    for (let i = 0; i < 4; i++) setTimeout(ping, i * 150);
    pingTimer = setInterval(ping, every);
  }
  function stopClockSync() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
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
  /** cb(hostId|null, isMe) on every host change; replays the current host. */
  function onHostChange(cb) {
    hostChangeHandlers.add(cb);
    if (hostId) { try { cb(hostId, !!room && hostId === room.sessionId); } catch { /* handler */ } }
    return () => hostChangeHandlers.delete(cb);
  }

  // --- queries ---

  function isConnected() { return connected; }
  function isSynced() { return hasSynced; }
  function getRoomId() { return room?.roomId || null; }
  function getSessionId() { return room?.sessionId || null; }
  function getPeers() { return peers; }
  function getLastError() { return lastError; }
  function getHostId() { return hostId; }
  function isHost() { return !!room && !!hostId && hostId === room.sessionId; }
  function peerInfo(sid) {
    const p = peers.get(sid);
    return p ? { sessionId: sid, clientId: p.clientId || '', displayName: p.displayName || '' } : null;
  }

  return {
    connect, disconnect, isConnected, isSynced, getRoomId, getSessionId, getPeers, getLastError,
    send, on, ping,
    getHostId, isHost, onHostChange, peerInfo,
    getRtt: clock.rtt, getMinRtt: clock.minRtt, isClockSynced: clock.isSynced,
    serverNow: () => clock.toServer(Date.now()),
    setData, deleteData, onData,
    onPeerJoin, onPeerLeave, onDisconnect,
  };
}
