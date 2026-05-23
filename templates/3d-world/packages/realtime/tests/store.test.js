/**
 * Tests for lib/store.js - the store channel.
 * Uses a mock transport with a real data map (synchronous server echo).
 * Run: node src/packages/realtime/tests/store.test.js
 */
import assert from 'node:assert/strict';
import { createStoreChannel } from '../lib/store.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

// Mock transport: a data map that echoes writes back through onData, the way
// the Colyseus state room would (synchronous here for deterministic tests).
function mockTransport() {
  const data = new Map();
  const cbs = new Set();
  const sent = [];
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
    // message relay - host stores use these for the command() channel
    send(type, payload) { sent.push([type, payload]); },
    on() { return () => {}; },
    getSessionId() { return 'me'; },
    _sent: sent,
  };
}
const obs = { bump: () => {} };
const newStore = (name, transport) => createStoreChannel({ name, transport: transport || mockTransport(), observability: obs });

test('set then get round-trips a whole object', () => {
  const s = newStore('game');
  s.set('state', { board: [0, 1, 2], turn: 2 });
  assert.deepEqual(s.get('state'), { board: [0, 1, 2], turn: 2 });
});

test('get returns the fallback for an unset key', () => {
  const s = newStore('game');
  assert.equal(s.get('missing', 'fb'), 'fb');
  assert.equal(s.get('missing'), undefined);
});

test('onChange fires with (key, value, prev)', () => {
  const s = newStore('game');
  const seen = [];
  s.onChange((key, value, prev) => seen.push([key, value, prev]));
  s.set('turn', 1);
  s.set('turn', 2);
  assert.deepEqual(seen, [['turn', 1, undefined], ['turn', 2, 1]]);
});

test('update shallow-merges into the existing object', () => {
  const s = newStore('game');
  s.set('meta', { name: 'A', round: 1 });
  const merged = s.update('meta', { round: 2 });
  assert.deepEqual(merged, { name: 'A', round: 2 });
  assert.deepEqual(s.get('meta'), { name: 'A', round: 2 });
});

test('update on an unset key starts from an empty object', () => {
  const s = newStore('game');
  assert.deepEqual(s.update('fresh', { a: 1 }), { a: 1 });
});

test('delete removes the key and fires onChange with undefined', () => {
  const s = newStore('game');
  s.set('k', { v: 1 });
  let last;
  s.onChange((key, value) => { last = [key, value]; });
  s.delete('k');
  assert.equal(s.has('k'), false);
  assert.deepEqual(last, ['k', undefined]);
});

test('has / keys / entries / all reflect the contents', () => {
  const s = newStore('game');
  s.set('a', 1);
  s.set('b', 2);
  assert.equal(s.has('a'), true);
  assert.deepEqual(s.keys().sort(), ['a', 'b']);
  assert.deepEqual([...s.all().entries()].sort(), [['a', 1], ['b', 2]]);
  assert.equal(s.entries().length, 2);
});

test('channels namespace - two stores on one transport stay isolated', () => {
  const t = mockTransport();
  const a = newStore('lobby', t);
  const b = newStore('match', t);
  a.set('k', 'in-lobby');
  assert.equal(a.get('k'), 'in-lobby');
  assert.equal(b.get('k'), undefined);
});

test('a store sees keys already in the data map when it opens', () => {
  const t = mockTransport();
  const a = newStore('room', t);
  a.set('seed', { x: 1 });
  const b = newStore('room', t); // opens late - should hydrate from the map
  assert.deepEqual(b.get('seed'), { x: 1 });
});

test('oversize value throws rather than being silently dropped', () => {
  const s = newStore('game');
  assert.throws(() => s.set('big', { blob: 'x'.repeat(11000) }), /exceeds|over the/i);
});

// ── host-authoritative store ───────────────────────────────────────────────

test('host store: a non-host set() is gated - no write, warns loudly', () => {
  const t = mockTransport();
  // election is not initialized here, so isHost() is false
  const s = createStoreChannel({ name: 'g', transport: t, observability: obs, authority: 'host' });
  const origWarn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try { s.set('state', { turn: 1 }); } finally { console.warn = origWarn; }
  assert.equal(s.has('state'), false, 'a non-host write must not reach the data map');
  assert.equal(warned, true, 'a blocked write must warn, not fail silently');
});

test('host store: command() sends a namespaced intent message', () => {
  const t = mockTransport();
  const s = createStoreChannel({ name: 'g', transport: t, observability: obs, authority: 'host' });
  s.command('move', { col: 3 });
  assert.equal(t._sent.length, 1);
  assert.equal(t._sent[0][0], 'g:command');
  assert.equal(t._sent[0][1].type, 'move');
  assert.deepEqual(t._sent[0][1].data, { col: 3 });
});

test('host store exposes the authority surface; a shared store does not', () => {
  const host = createStoreChannel({ name: 'g', transport: mockTransport(), observability: obs, authority: 'host' });
  for (const m of ['isHost', 'command', 'onCommand', 'onHost']) {
    assert.equal(typeof host[m], 'function', `host store missing ${m}`);
  }
  const shared = createStoreChannel({ name: 's', transport: mockTransport(), observability: obs });
  assert.equal(shared.command, undefined);
  assert.equal(shared.authority, 'shared');
});

console.log(`\nstore.test.js: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
