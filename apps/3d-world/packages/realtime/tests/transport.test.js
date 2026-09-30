/**
 * Tests for lib/transport.js - the host role and handoff client logic, over a
 * fake Colyseus room: applying __host announcements, the epoch stamp on
 * outgoing messages, host-only requests, the handoff heartbeat, page
 * visibility, undelivered notices, and connect()'s wait for the first __host.
 * Run: node tests/transport.test.js
 */
import assert from 'node:assert/strict';
import { createTransport, MAX_CHECKPOINT_BYTES } from '../lib/transport.js';
import { createObservability } from '../lib/observability.js';
import { classifyJoinError } from '../lib/errors.js';

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A fake Colyseus room: records what the kit sends; the test plays the server. */
function fakeRoom(sessionId = 'me') {
  const handlers = { message: null, state: null, leave: null, error: null };
  return {
    sessionId,
    roomId: 'room-1',
    reconnectionToken: 'tok',
    sent: [],
    send(type, msg) { this.sent.push([type, msg]); },
    onStateChange(cb) { handlers.state = cb; },
    onMessage(type, cb) { if (type === '*') handlers.message = cb; },
    onLeave(cb) { handlers.leave = cb; },
    onError(cb) { handlers.error = cb; },
    leave() {},
    /** The server sends a message. */
    deliver(type, data) { handlers.message(type, data); },
    /** The server patches state: players { sid: { visible, ... } }. */
    patch(players, extra = {}) {
      const map = new Map(Object.entries(players));
      handlers.state({ players: map, data: new Map(), ...extra });
    },
    of(type) { return this.sent.filter(([t]) => t === type).map(([, m]) => m); },
  };
}

/** A fake shared client whose joins hand out `room`. `onJoin` runs right
 *  after the join resolves (the server's __host follows the join). */
function fakeClient(room, { onJoin } = {}) {
  const joins = [];
  const join = async (opts) => { joins.push(opts); setTimeout(() => onJoin?.(room), 0); return room; };
  return {
    joins,
    configure() {},
    getAppGuid: () => 'app1',
    acquireToken: async () => 't',
    colyseusClient: async () => ({
      joinOrCreate: (_t, o) => join(o), create: (_t, o) => join(o), join: (_t, o) => join(o),
      joinById: (_id, o) => join(o), reconnect: async () => { throw new Error('no seat'); },
    }),
  };
}

const QUIET = { clockSyncMs: 0 };   // no clock pings: every __ping is a heartbeat

/** A connected transport on a fake room; the server announces `first`. */
async function connected(first = { hostId: null, hostEpoch: 0 }, cfg = {}, sessionId = 'me') {
  const room = fakeRoom(sessionId);
  const client = fakeClient(room, { onJoin: (r) => r.deliver('__host', first) });
  const obs = createObservability();
  const t = createTransport({ client, observability: obs });
  await t.connect({ room: 'table', settings: QUIET, ...cfg });
  return { t, room, obs, client };
}

// --- connect() and the first __host ---

test('connect() returns as soon as the first __host arrives, not after the 2 s wait', async () => {
  const started = Date.now();
  const { t } = await connected({ hostId: 'h', hostEpoch: 3 });
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
  assert.equal(t.getHostId(), 'h');
  assert.equal(t.getHostEpoch(), 3);
  t.disconnect();
});

test('connect() still returns (after the wait) when no __host ever arrives', async () => {
  const room = fakeRoom();
  const t = createTransport({ client: fakeClient(room), observability: createObservability() });
  const started = Date.now();
  assert.equal(await t.connect({ room: 'table', settings: QUIET }), room);
  const took = Date.now() - started;
  assert.ok(took >= 1900 && took < 3500, `took ${took} ms`);
  assert.equal(t.getHostId(), null);
  assert.equal(t.isHost(), false);
  t.disconnect();
});

// --- applying __host ---

test('__host: hostId, hostEpoch, previousHostId, reason and isMe reach onHostChange', async () => {
  const { t, room } = await connected({ hostId: 'h', hostEpoch: 1, previousHostId: null, reason: 'claimed' });
  const events = [];
  t.onHostChange((e) => events.push(e));
  assert.deepEqual(events, [{ hostId: 'h', hostEpoch: 1, previousHostId: null, reason: 'claimed', isMe: false, checkpoint: null }],
    'the current host is replayed to a new handler');
  room.deliver('__host', { hostId: 'me', hostEpoch: 2, previousHostId: 'h', reason: 'hidden', checkpoint: { data: { round: 4 }, serverTs: 5, hostEpoch: 1 } });
  assert.deepEqual(events.at(-1), {
    hostId: 'me', hostEpoch: 2, previousHostId: 'h', reason: 'hidden', isMe: true,
    checkpoint: { data: { round: 4 }, serverTs: 5, hostEpoch: 1 },
  });
  assert.equal(t.isHost(), true);
  assert.equal(t.getHostEpoch(), 2);
  t.disconnect();
});

test('__host: a checkpoint is only ever surfaced to the new host itself', async () => {
  const { t, room } = await connected({ hostId: 'h', hostEpoch: 1, reason: 'claimed' });
  const events = [];
  t.onHostChange((e) => events.push(e));
  // Even if one reached a peer, the kit would not surface it there.
  room.deliver('__host', { hostId: 'other', hostEpoch: 2, previousHostId: 'h', reason: 'transfer', checkpoint: { data: 1 } });
  assert.equal(events.at(-1).checkpoint, null);
  assert.equal(events.at(-1).isMe, false);
  // The new host keeps the checkpoint it was handed for later handlers...
  room.deliver('__host', { hostId: 'me', hostEpoch: 3, previousHostId: 'other', reason: 'transfer', checkpoint: { data: 2 } });
  const late = [];
  t.onHostChange((e) => late.push(e));
  assert.deepEqual(late[0].checkpoint, { data: 2 });
  // ...and drops it once the role moves on, so getting the role back later
  // never resurfaces a stale one.
  room.deliver('__host', { hostId: 'other', hostEpoch: 4, previousHostId: 'me', reason: 'transfer' });
  assert.equal(events.at(-1).checkpoint, null);
  room.deliver('__host', { hostId: 'me', hostEpoch: 5, previousHostId: 'other', reason: 'resumed' });
  assert.equal(events.at(-1).isMe, true);
  assert.equal(events.at(-1).checkpoint, null, 'no stale checkpoint on a later regain');
  t.disconnect();
});

test('__host: an older epoch is ignored; a repeat of the current one fires nothing', async () => {
  const { t, room } = await connected({ hostId: 'h', hostEpoch: 5, reason: 'claimed' });
  const events = [];
  t.onHostChange((e) => events.push(e));
  events.length = 0;
  room.deliver('__host', { hostId: 'x', hostEpoch: 4, reason: 'claimed' });   // late, out of order
  assert.equal(t.getHostId(), 'h');
  assert.equal(t.getHostEpoch(), 5);
  room.deliver('__host', { hostId: 'h', hostEpoch: 5, reason: 'claimed' });   // re-announced after a reconnect
  assert.equal(events.length, 0);
  room.deliver('__host', { hostId: null, hostEpoch: 6, previousHostId: 'h', reason: 'vacated' });
  assert.deepEqual([t.getHostId(), t.getHostEpoch(), t.isHost()], [null, 6, false]);
  assert.equal(events.at(-1).reason, 'vacated');
  t.disconnect();
});

test('isHost()/hostEpoch() follow the role across changes', async () => {
  const { t, room } = await connected({ hostId: 'me', hostEpoch: 1, reason: 'claimed' });
  const seen = [[t.isHost(), t.getHostEpoch()]];
  room.deliver('__host', { hostId: 'p', hostEpoch: 2, previousHostId: 'me', reason: 'grace-expired' });
  seen.push([t.isHost(), t.getHostEpoch()]);
  room.deliver('__host', { hostId: 'me', hostEpoch: 3, previousHostId: 'p', reason: 'transfer' });
  seen.push([t.isHost(), t.getHostEpoch()]);
  assert.deepEqual(seen, [[true, 1], [false, 2], [true, 3]]);
  t.disconnect();
  assert.equal(t.isHost(), false, 'no room, no role');
});

// --- the epoch stamp on outgoing messages ---

test('send(): stamped __hostEpoch only while host; the caller\'s object is never mutated', async () => {
  const { t, room } = await connected({ hostId: 'me', hostEpoch: 2, reason: 'claimed' });
  const data = { lines: 4 };
  t.send('game:gb', data);
  t.send('game:gb', data, { to: 'p1' });
  t.send('game:raw', 7);
  assert.deepEqual(room.of('game:gb'), [{ lines: 4, __hostEpoch: 2 }, { lines: 4, __to: 'p1', __hostEpoch: 2 }]);
  assert.deepEqual(room.of('game:raw'), [{ data: 7, __hostEpoch: 2 }]);
  assert.deepEqual(data, { lines: 4 }, 'caller object untouched');

  room.deliver('__host', { hostId: 'p1', hostEpoch: 3, previousHostId: 'me', reason: 'hidden' });
  t.send('game:st', data);
  t.send('game:press', { key: 'up' }, { to: 'host' });
  assert.equal(room.of('game:st')[0], data, 'a peer sends the object as is');
  assert.deepEqual(room.of('game:press'), [{ key: 'up', __to: 'host' }]);
  t.disconnect();
});

// --- undelivered ---

test('__undelivered (stale-host) becomes an undelivered event split into channel + type; never an app message', async () => {
  const { t, room, obs } = await connected({ hostId: 'me', hostEpoch: 1, reason: 'claimed' });
  const events = [];
  obs.on('undelivered', (e) => events.push(e));
  const leaked = [];
  for (const type of ['__undelivered', '__host', '__host_key', '__pong', '__visibility']) t.on(type, () => leaked.push(type));
  room.deliver('__undelivered', { type: 'game:gb', to: null, reason: 'stale-host' });
  room.deliver('__undelivered', { type: '__checkpoint', to: null, reason: 'stale-host' });
  room.deliver('__undelivered', { type: 'game:tick', to: ['p2'], reason: 'no-recipient' });
  assert.deepEqual(events, [
    { channel: 'game', type: 'gb', to: null, reason: 'stale-host' },
    { channel: null, type: '__checkpoint', to: null, reason: 'stale-host' },
    { channel: 'game', type: 'tick', to: ['p2'], reason: 'no-recipient' },
  ]);
  assert.equal(obs.snapshot().undelivered, 3);
  room.deliver('__host', { hostId: 'me', hostEpoch: 1 });
  room.deliver('__host_key', { key: 'k' });
  room.deliver('__pong', { t: 1, serverTs: 2 });
  room.deliver('__visibility', { sessionId: 'x', visible: false });
  assert.deepEqual(leaked, [], 'internal types never reach app handlers');
  t.disconnect();
});

test('app messages get sid aligned with the server-stamped senderId', async () => {
  const { t, room } = await connected();
  const got = [];
  t.on('game:gb', (m) => got.push(m));
  room.deliver('game:gb', { lines: 1, sid: 'spoof', senderId: 'p1', hostEpoch: 2 });
  assert.deepEqual(got, [{ lines: 1, sid: 'p1', senderId: 'p1', hostEpoch: 2 }]);
  t.disconnect();
});

// --- host-only requests ---

test('setCheckpoint: false (nothing sent) when not host; sent with the epoch when host', async () => {
  const { t, room } = await connected({ hostId: 'other', hostEpoch: 1, reason: 'claimed' });
  assert.equal(t.setCheckpoint({ round: 1 }), false);
  assert.equal(room.of('__checkpoint').length, 0);
  room.deliver('__host', { hostId: 'me', hostEpoch: 2, previousHostId: 'other', reason: 'transfer' });
  assert.equal(t.setCheckpoint({ round: 2 }), true);
  assert.equal(t.setCheckpoint(undefined), true);
  assert.deepEqual(room.of('__checkpoint'), [{ data: { round: 2 }, __hostEpoch: 2 }, { data: null, __hostEpoch: 2 }]);
  t.disconnect();
});

test('setCheckpoint: up to 64 KB of JSON (UTF-8 bytes) is sent; one byte more throws RangeError', async () => {
  const { t, room } = await connected({ hostId: 'me', hostEpoch: 1, reason: 'claimed' });
  const overhead = '{"s":""}'.length;
  assert.equal(t.setCheckpoint({ s: 'x'.repeat(MAX_CHECKPOINT_BYTES - overhead) }), true);
  assert.throws(() => t.setCheckpoint({ s: 'x'.repeat(MAX_CHECKPOINT_BYTES - overhead + 1) }), RangeError);
  // Multi-byte characters count as bytes, not characters: 2 bytes each.
  assert.throws(() => t.setCheckpoint({ s: 'é'.repeat((MAX_CHECKPOINT_BYTES - overhead) / 2 + 1) }), RangeError);
  assert.equal(room.of('__checkpoint').length, 1, 'a refused checkpoint sends nothing');
  t.disconnect();
});

test('setSuccessors / transferHost: false when not host; sent with the epoch when host', async () => {
  const { t, room } = await connected({ hostId: 'other', hostEpoch: 4, reason: 'claimed' });
  assert.equal(t.setSuccessors(['a']), false);
  assert.equal(t.transferHost('a'), false);
  assert.equal(room.sent.filter(([ty]) => ty === '__successors' || ty === '__transfer_host').length, 0);
  room.deliver('__host', { hostId: 'me', hostEpoch: 5, previousHostId: 'other', reason: 'transfer' });
  assert.equal(t.setSuccessors(['a', 'b']), true);
  assert.equal(t.setSuccessors('nope'), true);
  assert.equal(t.transferHost('a'), true);
  assert.deepEqual(room.of('__successors'), [{ ids: ['a', 'b'], __hostEpoch: 5 }, { ids: [], __hostEpoch: 5 }]);
  assert.deepEqual(room.of('__transfer_host'), [{ to: 'a', __hostEpoch: 5 }]);
  t.disconnect();
  assert.equal(t.transferHost('a'), false, 'disconnected: nothing to send on');
});

test('announceLeaving: sent with the epoch only by a handoff host; false otherwise', async () => {
  // A peer, even on a handoff table, has nothing to announce.
  const { t, room } = await connected({ hostId: 'p', hostEpoch: 2, reason: 'claimed', heartbeatMs: 30 });
  assert.equal(t.announceLeaving(), false);
  // The host of a table without handoff (no heartbeatMs): nothing to hand on.
  room.deliver('__host', { hostId: 'me', hostEpoch: 3, previousHostId: 'p', reason: 'transfer' });
  assert.equal(t.announceLeaving(), false);
  assert.equal(room.of('__host_leaving').length, 0);
  // A handoff host (the server asked it to heartbeat): the notice goes out, stamped.
  room.deliver('__host', { hostId: 'me', hostEpoch: 4, previousHostId: 'me', reason: 'resumed', heartbeatMs: 40 });
  assert.equal(t.announceLeaving(), true);
  assert.deepEqual(room.of('__host_leaving'), [{ __hostEpoch: 4 }]);
  t.disconnect();
  assert.equal(t.announceLeaving(), false, 'disconnected: nothing to send on');
});

// --- the handoff heartbeat ---

test('heartbeat: runs at heartbeatMs while host, stops when the role moves on', async () => {
  // Only the host is asked to heartbeat; a peer never does, whatever it hears.
  const { t, room } = await connected({ hostId: 'p', hostEpoch: 1, reason: 'claimed', heartbeatMs: 30 });
  await sleep(150);
  assert.equal(room.of('__ping').length, 0, 'a peer does not heartbeat');
  room.deliver('__host', { hostId: 'me', hostEpoch: 2, previousHostId: 'p', reason: 'transfer', heartbeatMs: 40 });
  await sleep(230);
  const beats = room.of('__ping').length;
  assert.ok(beats >= 2 && beats <= 8, `${beats} heartbeats in 230 ms at 40 ms`);
  room.deliver('__host', { hostId: 'p', hostEpoch: 3, previousHostId: 'me', reason: 'transfer' });
  const after = room.of('__ping').length;
  await sleep(150);
  assert.equal(room.of('__ping').length, after, 'no heartbeat after losing the role');
  t.disconnect();
});

test('heartbeat: none without heartbeatMs (handoff off); stopped by disconnect()', async () => {
  const { t, room } = await connected({ hostId: 'me', hostEpoch: 1, reason: 'claimed' });
  await sleep(150);
  assert.equal(room.of('__ping').length, 0, 'handoff off: no heartbeat');
  room.deliver('__host', { hostId: 'me', hostEpoch: 1, reason: 'claimed', heartbeatMs: 30 });
  await sleep(100);
  assert.ok(room.of('__ping').length >= 2, 'heartbeat from a re-announce that asks for it');
  t.disconnect();
  const after = room.of('__ping').length;
  await sleep(100);
  assert.equal(room.of('__ping').length, after, 'stopped by disconnect');
});

// --- page visibility ---

function fakeDocument() {
  const listeners = new Set();
  return {
    hidden: false,
    querySelector: () => null,
    addEventListener(type, cb) { if (type === 'visibilitychange') listeners.add(cb); },
    set(hidden) { this.hidden = hidden; for (const cb of listeners) cb(); },
  };
}

test('visibility: the join says whether the page is visible; changes are reported to the room', async () => {
  const doc = fakeDocument();
  globalThis.document = doc;
  try {
    doc.hidden = true;
    const { t, room, client } = await connected({ hostId: null, hostEpoch: 0 });
    assert.equal(client.joins[0].visible, false, 'a page that joins while hidden says so');
    doc.set(false);
    doc.set(true);
    assert.deepEqual(room.of('__visibility'), [{ visible: true }, { visible: false }]);
    t.disconnect();
    doc.set(false);
    assert.equal(room.of('__visibility').length, 2, 'nothing sent after disconnect');
  } finally { delete globalThis.document; }
});

test('peer visibility: state flips fire onPeerVisibility and peerInfo(); the first sighting does not', async () => {
  const { t, room } = await connected();
  const vis = [];
  t.onPeerVisibility((sid, visible) => vis.push([sid, visible]));
  room.patch({ me: { visible: true }, p1: { visible: true, clientId: 'c1', displayName: 'P' }, p2: { visible: false } });
  assert.deepEqual(vis, [], 'joining peers are not visibility changes');
  assert.deepEqual(t.peerInfo('p2'), { sessionId: 'p2', clientId: '', displayName: '', visible: false, seats: 1 });
  room.patch({ me: { visible: true }, p1: { visible: false, clientId: 'c1', displayName: 'P' }, p2: { visible: false } });
  room.patch({ me: { visible: true }, p1: { visible: true, clientId: 'c1', displayName: 'P' }, p2: { visible: true } });
  assert.deepEqual(vis, [['p1', false], ['p1', true], ['p2', true]]);
  assert.deepEqual(t.peerInfo('p1'), { sessionId: 'p1', clientId: 'c1', displayName: 'P', visible: true, seats: 1 });
  // Relay rooms announce visibility as a message instead.
  room.deliver('__visibility', { sessionId: 'p1', visible: false });
  room.deliver('__visibility', { sessionId: 'p1', visible: false });    // no change, no event
  room.deliver('__visibility', { sessionId: 'ghost', visible: false }); // not a peer
  assert.deepEqual(vis.at(-1), ['p1', false]);
  assert.equal(vis.length, 4);
  assert.equal(t.peerInfo('me'), null, 'this page is not its own peer');
  t.disconnect();
});

// --- seats ---

test('seats: joins carry seats, only a create carries maxSeats; peerInfo and seats() count them', async () => {
  const { t, room, client } = await connected(undefined, { mode: 'create', seats: 3, maxSeats: 8 });
  assert.equal(client.joins[0].seats, 3);
  assert.equal(client.joins[0].maxSeats, 8);
  assert.deepEqual(t.getSeats(), { used: 3, total: 8, mine: 3 }, 'known before the first patch');
  room.patch({ me: { seats: 3 }, p1: { seats: 2 }, p2: {} }, { maxSeats: 8, seatsUsed: 6 });
  assert.equal(t.peerInfo('p1').seats, 2);
  assert.equal(t.peerInfo('p2').seats, 1, 'a server without seats: one per connection');
  assert.deepEqual(t.getSeats(), { used: 6, total: 8, mine: 3 });
  t.disconnect();
  assert.deepEqual(t.getSeats(), { used: 0, total: 0, mine: 0 });

  const j = await connected(undefined, { mode: 'joinById', roomId: 'room-1', seats: 2, maxSeats: 99 });
  assert.equal(j.client.joins[0].seats, 2);
  assert.equal('maxSeats' in j.client.joins[0], false, 'only the creator sets capacity');
  j.t.disconnect();
  const plain = await connected();
  assert.equal('seats' in plain.client.joins[0], false, 'no seats option: the wire is as before');
  plain.t.disconnect();
});

test('a join refused for lack of seats fails fast (no retry)', async () => {
  let attempts = 0;
  const client = {
    configure() {},
    getAppGuid: () => 'app1',
    acquireToken: async () => 't',
    colyseusClient: async () => ({
      joinById: async () => { attempts += 1; throw Object.assign(new Error("Room 'match' is full: 3 seats requested, 2 of 8 free"), { code: 4216 }); },
      reconnect: async () => { throw new Error('no seat'); },
    }),
  };
  const t = createTransport({ client, observability: createObservability() });
  const room = await t.connect({ room: 'match', mode: 'joinById', roomId: 'r', seats: 3, settings: QUIET });
  assert.equal(room, null);
  assert.equal(attempts, 1);
  assert.equal(classifyJoinError(t.getLastError()), 'full');
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('  ok   -', name); }
    catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
  }
  console.log(`\ntransport.test.js: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
