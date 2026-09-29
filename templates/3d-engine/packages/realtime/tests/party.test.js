/**
 * Tests for lib/party.js - host / join-by-code / browse / quick-match.
 * Uses a fake rt: a real store channel (synchronous echo) backs the lobby
 * directory; match rooms are stubs whose joinById behavior is scripted.
 * Run: node src/packages/realtime/tests/party.test.js
 */
import assert from 'node:assert/strict';
import { createParty } from '../lib/party.js';
import { RealtimeJoinError } from '../lib/errors.js';
import { createStoreChannel } from '../lib/store.js';

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

// Synchronous-echo data map (same shape directory.test.js uses).
function mockTransport() {
  const data = new Map();
  const cbs = new Set();
  return {
    setData(key, value) {
      const prev = data.get(key);
      data.set(key, value);
      for (const cb of cbs) cb(key, value, prev);
    },
    deleteData(key) {
      const prev = data.get(key);
      data.delete(key);
      for (const cb of cbs) cb(key, undefined, prev);
    },
    onData(cb) {
      cbs.add(cb);
      for (const [k, v] of data) cb(k, v, undefined);
      return () => cbs.delete(cb);
    },
  };
}

function fakeMatchRoom(id) {
  const joinCbs = new Set();
  const leaveCbs = new Set();
  const peers = new Map();
  let disconnected = false;
  return {
    getRoomId: () => id,
    disconnect: () => { disconnected = true; },
    peers: () => peers,
    onPeerJoin: (cb) => { joinCbs.add(cb); return () => joinCbs.delete(cb); },
    onPeerLeave: (cb) => { leaveCbs.add(cb); return () => leaveCbs.delete(cb); },
    channel: () => ({}),
    _addPeer(sid) { peers.set(sid, {}); for (const cb of [...joinCbs]) cb(sid); },
    _removePeer(sid) { peers.delete(sid); for (const cb of [...leaveCbs]) cb(sid); },
    get _disconnected() { return disconnected; },
  };
}

/**
 * Fake rt. `joinable` maps roomId -> fakeMatchRoom | RealtimeJoinError code.
 * All parties built on the same fake share one lobby data map, so a host's
 * published entry is visible to a joiner - like two browsers on one server.
 */
function fakeRt() {
  const lobbyTransport = mockTransport();
  const joinable = new Map();
  const resumable = new Set();
  let nextId = 1;
  let lobbyDown = false;
  return {
    async join(name) {
      if (lobbyDown) throw new RealtimeJoinError('failed', `join '${name}' failed`);
      return {
        channel: (chName) => createStoreChannel({ name: chName, transport: lobbyTransport, observability: { bump: () => {} } }),
        disconnect: () => {},
        on: () => () => {},
      };
    },
    async create() {
      const room = fakeMatchRoom(`r${nextId++}`);
      joinable.set(room.getRoomId(), room);
      return room;
    },
    async joinById(roomId) {
      const target = joinable.get(roomId);
      if (!target || typeof target === 'string') {
        throw new RealtimeJoinError(typeof target === 'string' ? target : 'gone', `room ${roomId} unavailable`);
      }
      return target;
    },
    // Rooms where this "browser" left a held seat behind (its page died).
    async resume(name, { roomId } = {}) {
      if (!resumable.has(roomId)) throw new RealtimeJoinError('not-found', 'no held seat to resume');
      return joinable.get(roomId);
    },
    _joinable: joinable,
    _resumable: resumable,
    _setLobbyDown(v) { lobbyDown = v; },
  };
}

// heartbeatMs large (but 32-bit safe) so the interval never fires mid-test;
// syncWaitMs 0 because the mock lobby never emits a sync event.
const newParty = (rt, opts) => createParty(rt, { heartbeatMs: 2 ** 30, syncWaitMs: 0, ...opts });

test('host publishes an open listing with a code and roomId', async () => {
  const rt = fakeRt();
  const party = newParty(rt);
  const table = await party.host({ host: 'Sam' });
  assert.ok(table.isHost);
  assert.match(table.code, /^[A-Z2-9]{4}$/);
  const tables = await party.tables();
  assert.equal(tables.length, 1);
  assert.equal(tables[0].code, table.code);
  assert.equal(tables[0].roomId, table.roomId);
  assert.equal(tables[0].host, 'Sam');
  assert.equal(tables[0].status, 'open');
});

test('host honours a forced code and re-rolls a colliding random one', async () => {
  const rt = fakeRt();
  const party = newParty(rt);
  const forced = await party.host({ code: 'ZZZZ' });
  assert.equal(forced.code, 'ZZZZ');
  const other = await party.host({});
  assert.notEqual(other.code, 'ZZZZ');
});

test('cancel() delists the table and disconnects the room (no ghost tables)', async () => {
  const rt = fakeRt();
  const party = newParty(rt);
  const table = await party.host({ host: 'Sam' });
  assert.equal((await party.tables()).length, 1);
  table.cancel();
  assert.equal((await party.tables()).length, 0);
  assert.ok(rt._joinable.get(table.roomId)._disconnected);
});

test('onFull fires when the table fills and the listing flips to playing', async () => {
  const rt = fakeRt();
  const party = newParty(rt, { seats: 2 });
  const table = await party.host({ host: 'Sam' });
  let full = 0;
  table.onFull(() => { full += 1; });
  rt._joinable.get(table.roomId)._addPeer('guest-1');
  assert.equal(full, 1);
  assert.equal((await party.tables()).length, 0, 'a playing table is no longer browsable');
});

test('joinByCode joins the advertised table', async () => {
  const rt = fakeRt();
  const host = newParty(rt);
  const joiner = newParty(rt);
  const hosted = await host.host({ host: 'Sam' });
  const table = await joiner.joinByCode(hosted.code.toLowerCase());
  assert.equal(table.isHost, false);
  assert.equal(table.roomId, hosted.roomId);
  assert.equal(table.entry.host, 'Sam');
});

test('joinByCode: unknown code rejects with not-found after the timeout', async () => {
  const rt = fakeRt();
  const party = newParty(rt);
  await assert.rejects(
    party.joinByCode('NOPE', { timeoutMs: 300 }),
    (err) => err instanceof RealtimeJoinError && err.code === 'not-found',
  );
});

test('joinByCode: a full table rejects immediately with full', async () => {
  const rt = fakeRt();
  const host = newParty(rt);
  const hosted = await host.host({ host: 'Sam' });
  rt._joinable.set(hosted.roomId, 'full');
  await assert.rejects(
    newParty(rt).joinByCode(hosted.code, { timeoutMs: 5000 }),
    (err) => err.code === 'full',
  );
});

test('joinByCode: a dead listing (room gone) resolves to not-found, not a hang', async () => {
  const rt = fakeRt();
  const host = newParty(rt);
  const hosted = await host.host({ host: 'Sam' });
  rt._joinable.delete(hosted.roomId);
  await assert.rejects(
    newParty(rt).joinByCode(hosted.code, { timeoutMs: 400 }),
    (err) => err.code === 'not-found',
  );
});

test('quickMatch joins an open table, or hosts when none exist', async () => {
  const rt = fakeRt();
  const host = newParty(rt);
  const hosted = await host.host({ host: 'Sam' });
  const joined = await newParty(rt).quickMatch({ host: 'Ada' });
  assert.equal(joined.isHost, false);
  assert.equal(joined.roomId, hosted.roomId);

  const rt2 = fakeRt();
  const alone = await newParty(rt2).quickMatch({ host: 'Solo' });
  assert.equal(alone.isHost, true);
});

test('quickMatch skips a dead listing and hosts instead of failing', async () => {
  const rt = fakeRt();
  const host = newParty(rt);
  const hosted = await host.host({ host: 'Sam' });
  rt._joinable.delete(hosted.roomId);
  const table = await newParty(rt).quickMatch({ host: 'Ada' });
  assert.equal(table.isHost, true);
});

test('lobby failure propagates as a typed error (no silent null)', async () => {
  const rt = fakeRt();
  rt._setLobbyDown(true);
  await assert.rejects(
    newParty(rt).tables(),
    (err) => err instanceof RealtimeJoinError,
  );
});

test('joining a table whose listing is not open rejects as full (client-side seat gate)', async () => {
  const rt = fakeRt();
  const host = newParty(rt, { seats: 2 });
  const hosted = await host.host({ host: 'Sam' });
  rt._joinable.get(hosted.roomId)._addPeer('guest-1');   // fills -> listing 'playing'
  const joiner = newParty(rt);
  await assert.rejects(
    joiner.joinByCode(hosted.code, { timeoutMs: 3000 }),
    (err) => err.code === 'full',
  );
  const [entry] = (await joiner.tables());
  assert.equal(entry, undefined, 'playing tables are not browsable');
});

test('hosting again replaces the previous waiting table (no orphaned listing)', async () => {
  const rt = fakeRt();
  const party = newParty(rt);
  const t1 = await party.host({ host: 'Sam', code: 'AAAA' });
  const t2 = await party.host({ host: 'Sam', code: 'BBBB' });
  const codes = (await party.tables()).map((e) => e.code);
  assert.deepEqual(codes, ['BBBB']);
  assert.ok(rt._joinable.get(t1.roomId)._disconnected, 'first room was disconnected');
  // The new table's listing is intact and independently cancelable.
  t2.cancel();
  assert.equal((await party.tables()).length, 0);
});

test('an old table handle cannot clobber the new table listing', async () => {
  const rt = fakeRt();
  const party = newParty(rt);
  const t1 = await party.host({ host: 'Sam', code: 'AAAA' });
  const t2 = await party.host({ host: 'Sam', code: 'BBBB' });
  t1.cancel();      // already canceled by the re-host; must be a no-op
  t1.setListing({ status: 'zombie' });
  const [entry] = await party.tables();
  assert.equal(entry.code, 'BBBB');
  assert.equal(entry.status, 'open');
  assert.ok(t2.isHost);
});

test('onFull fires immediately when the table is already full at registration', async () => {
  const rt = fakeRt();
  const party = newParty(rt, { seats: 2 });
  const table = await party.host({ host: 'Sam' });
  rt._joinable.get(table.roomId)._addPeer('guest-1');
  let fired = 0;
  table.onFull(() => { fired += 1; });
  await Promise.resolve();  // onFull's immediate path fires on a microtask
  await Promise.resolve();
  assert.equal(fired, 1);
});

test('close() cancels a waiting hosted table and leaves the lobby', async () => {
  const rt = fakeRt();
  const party = newParty(rt);
  const table = await party.host({ host: 'Sam' });
  party.close();
  assert.ok(rt._joinable.get(table.roomId)._disconnected);
  assert.equal(party.lobbyRoom(), null);
});

test('unprovisioned room name classifies distinctly, not as a gone game', async () => {
  const rt = fakeRt();
  rt.join = async () => { throw new RealtimeJoinError('unprovisioned', "Room 'lobby' not found for this project"); };
  await assert.rejects(
    newParty(rt).tables(),
    (err) => err.code === 'unprovisioned',
  );
});

test('a full table reopens when a seat frees, so a reloading player can rejoin by code', async () => {
  const rt = fakeRt();
  const host = newParty(rt, { seats: 3 });
  const hosted = await host.host({ host: 'TV' });
  const room = rt._joinable.get(hosted.roomId);
  room._addPeer('phone-1');
  room._addPeer('phone-2');            // 3 of 3 -> playing
  assert.equal((await host.tables()).length, 0, 'a full table is not browsable');
  room._removePeer('phone-2');         // clean leave, or its seat hold ran out
  const [entry] = await host.tables();
  assert.equal(entry?.status, 'open', 'the listing reopened');
  const again = await newParty(rt).joinByCode(hosted.code, { timeoutMs: 1000 });
  assert.equal(again.roomId, hosted.roomId);
  room._addPeer('phone-2b');           // full again -> playing again
  assert.equal((await host.tables()).length, 0, 'refilled table closes again');
});

test('an app-set status is never overridden by the kit reopening the table', async () => {
  const rt = fakeRt();
  const host = newParty(rt, { seats: 2 });
  const hosted = await host.host({ host: 'Sam' });
  const room = rt._joinable.get(hosted.roomId);
  room._addPeer('guest-1');
  hosted.setListing({ status: 'in-match' });   // the app closed joins at kickoff
  room._removePeer('guest-1');
  await assert.rejects(
    newParty(rt).joinByCode(hosted.code, { timeoutMs: 1000 }),
    (err) => err.code === 'full',
  );
  // Handing status back to the kit ('open') resumes the automatic flip.
  hosted.setListing({ status: 'open' });
  room._addPeer('guest-2');
  assert.equal((await host.tables()).length, 0);
});

test('a player whose own seat is held takes it back through a full table', async () => {
  const rt = fakeRt();
  const host = newParty(rt, { seats: 2 });
  const hosted = await host.host({ host: 'TV' });
  rt._joinable.get(hosted.roomId)._addPeer('phone-1');   // full -> playing
  // A stranger is refused...
  await assert.rejects(newParty(rt).joinByCode(hosted.code, { timeoutMs: 1000 }), (err) => err.code === 'full');
  // ...but the phone whose page crashed (seat still held) gets back in.
  rt._resumable.add(hosted.roomId);
  const back = await newParty(rt).joinByCode(hosted.code, { timeoutMs: 1000 });
  assert.equal(back.roomId, hosted.roomId);
  assert.equal(back.isHost, false);
});

test('inviteUrl/codeFromUrl are inert outside a browser', async () => {
  const rt = fakeRt();
  const party = newParty(rt);
  assert.equal(party.inviteUrl('ABCD'), '');
  assert.equal(party.codeFromUrl(), null);
  assert.equal(await party.joinFromUrl(), null);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('  ok   -', name); }
    catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
  }
  console.log(`\nparty.test.js: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
