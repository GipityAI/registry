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
// heartbeatMs huge so the interval never fires mid-test (process.exit clears it).
const newDir = (opts) => createDirectory(fakeRoom(mockTransport()), { heartbeatMs: 9e9, ...opts });

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

console.log(`\ndirectory.test.js: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
