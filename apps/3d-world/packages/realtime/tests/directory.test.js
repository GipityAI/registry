/**
 * Tests for lib/directory.js - the lobby directory helper.
 * Uses a mock transport + a real store channel (synchronous server echo).
 * Run: node src/packages/realtime/tests/directory.test.js
 */
import assert from 'node:assert/strict';
import { createDirectory } from '../lib/directory.js';
import { createStoreChannel } from '../lib/store.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

// Data map with synchronous echo - the store channel sits on top of this.
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
// A minimal room handle: .channel() returns a real store channel.
function fakeRoom(transport) {
  return {
    channel: (name) => createStoreChannel({ name, transport, observability: { bump: () => {} } }),
  };
}
// heartbeatMs at the timer maximum (~24.8 days; anything larger overflows to 1 ms)
// so the interval never fires mid-test (process.exit clears it).
const newDir = (opts) => createDirectory(fakeRoom(mockTransport()), { heartbeatMs: 2 ** 31 - 1, ...opts });

test('publish adds an entry that list() returns, tagged with _key', () => {
  const dir = newDir();
  dir.publish('m1', { host: 'Sam', status: 'open' });
  const list = dir.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].host, 'Sam');
  assert.equal(list[0]._key, 'm1');
  dir.unpublish();
});

test('list() hides stale entries; sweep() deletes them', () => {
  const dir = newDir({ staleMs: 1000 });
  dir.publish('fresh', { host: 'A' });
  dir.store.set('stale', { host: 'B', lastSeen: Date.now() - 5000 });
  const keys = dir.list().map((e) => e._key);
  assert.equal(keys.length, 1);
  assert.equal(keys[0], 'fresh');
  dir.sweep();
  assert.equal(dir.store.has('stale'), false);
  assert.equal(dir.store.has('fresh'), true);
  dir.unpublish();
});

test('update merges a patch into the published entry', () => {
  const dir = newDir();
  dir.publish('m', { host: 'Sam', status: 'open' });
  dir.update({ status: 'playing' });
  const e = dir.list()[0];
  assert.equal(e.host, 'Sam');
  assert.equal(e.status, 'playing');
  dir.unpublish();
});

test('unpublish removes this peer entry', () => {
  const dir = newDir();
  dir.publish('m', { host: 'Sam' });
  assert.equal(dir.list().length, 1);
  dir.unpublish();
  assert.equal(dir.list().length, 0);
});

test('onChange fires when the directory changes', () => {
  const dir = newDir();
  let fired = 0;
  dir.onChange(() => { fired += 1; });
  dir.publish('m', { host: 'Sam' });
  assert.ok(fired > 0, 'onChange should have fired');
  dir.unpublish();
});

test('publish returns a per-key handle; two entries never clobber each other', () => {
  const dir = newDir();
  const p1 = dir.publish('m1', { host: 'Sam', status: 'open' });
  const p2 = dir.publish('m2', { host: 'Sam', status: 'open' });
  p1.update({ status: 'playing' });        // touches only m1
  assert.equal(dir.list().find((e) => e._key === 'm2').status, 'open');
  p1.unpublish();                          // removes only m1
  const keys = dir.list().map((e) => e._key);
  assert.deepEqual(keys, ['m2']);
  p2.update({ status: 'playing' });        // p2 still works after p1 is gone
  assert.equal(dir.list()[0].status, 'playing');
  p2.unpublish();
  assert.equal(dir.list().length, 0);
});

test('top-level update/unpublish track the most recent publish', () => {
  const dir = newDir();
  dir.publish('a', { host: 'A' });
  dir.publish('b', { host: 'B' });
  dir.update({ status: 'playing' });
  assert.equal(dir.list().find((e) => e._key === 'b').status, 'playing');
  assert.equal(dir.list().find((e) => e._key === 'a').status, undefined);
  dir.unpublish();                         // removes b
  assert.deepEqual(dir.list().map((e) => e._key), ['a']);
  dir.unpublish();                         // then a
  assert.equal(dir.list().length, 0);
});

test('close() stops heart-beating without deleting live entries', () => {
  const dir = newDir();
  dir.publish('m', { host: 'Sam' });
  dir.close();
  // The entry is still in the store (it ages out for readers); no timer left.
  assert.equal(dir.store.has('m'), true);
  dir.update({ status: 'x' });             // no-op after close
  assert.equal(dir.list()[0].status, undefined);
});

test('release() hands an entry over: it stays listed, this peer stops writing it', () => {
  const dir = newDir();
  const pub = dir.publish('m', { host: 'Sam' });
  pub.release();
  assert.equal(dir.store.has('m'), true);
  pub.update({ status: 'x' });             // no longer ours: no-op
  assert.equal(dir.list()[0].status, undefined);
  pub.unpublish();                         // nor can we delete the new owner's entry
  assert.equal(dir.store.has('m'), true);
});

// The listing moves with a party's host role: the old host release()s and the
// new host publishes the same key. The old host's heartbeat must stop, or it
// would keep overwriting the new owner's entry with its stale copy.
try {
  const transport = mockTransport();
  const oldHost = createDirectory(fakeRoom(transport), { heartbeatMs: 20 });
  const newHost = createDirectory(fakeRoom(transport), { heartbeatMs: 2 ** 31 - 1 });
  const pub = oldHost.publish('T1', { host: 'TV', roomId: 'r1', status: 'open' });
  await new Promise((r) => setTimeout(r, 60));
  pub.release();
  newHost.publish('T1', { host: 'TV', roomId: 'r1', status: 'playing' });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(newHost.list()[0].status, 'playing', 'the released heartbeat never rewrites the entry');
  assert.equal(oldHost.list()[0].status, 'playing', 'both pages read the new owner\'s entry');
  newHost.close();
  passed++; console.log('  ok   - release() stops the heartbeat: the new owner\'s entry is never overwritten');
} catch (e) {
  failed++; console.error('  FAIL - release() stops the heartbeat', '\n        ', e.message);
}

console.log(`\ndirectory.test.js: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
