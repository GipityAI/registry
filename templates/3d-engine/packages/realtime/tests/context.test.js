/**
 * Tests for lib/context.js - adapter normalization.
 * Run: node src/packages/realtime/tests/context.test.js
 */
import assert from 'node:assert/strict';
import { normalizeAdapter } from '../lib/context.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

test('fills every section with safe no-ops', () => {
  const a = normalizeAdapter();
  assert.equal(typeof a.presence.encode, 'function');
  assert.equal(typeof a.entities.id, 'function');
  assert.equal(typeof a.authority.hasData, 'function');
});

test('keeps the methods the app supplied', () => {
  const myId = (e) => e.key;
  const a = normalizeAdapter({ entities: { id: myId } });
  assert.equal(a.entities.id, myId);
});

test('default presence.apply merges custom peer fields (named-roster case)', () => {
  // Without a custom adapter, a received payload (e.g. {name}) must land on the
  // peer record so the common "who's here" roster shows real names. (#164)
  const a = normalizeAdapter();
  const peer = a.presence.newPeer();
  a.presence.apply(peer, { name: 'Ada', color: 'orange' });
  assert.equal(peer.name, 'Ada');
  assert.equal(peer.color, 'orange');
});

test('default presence.apply ignores a non-object payload', () => {
  const a = normalizeAdapter();
  const peer = a.presence.newPeer();
  a.presence.apply(peer, null);
  assert.deepEqual(peer, {});
});

test('tracksDrift is true only when getDriftAnchor is supplied', () => {
  const physics = normalizeAdapter({ entities: { getDriftAnchor: () => ({ x: 0, y: 0, z: 0 }) } });
  assert.equal(physics.entities.tracksDrift, true);

  const nonPhysics = normalizeAdapter({ entities: { id: (e) => e.id } });
  assert.equal(nonPhysics.entities.tracksDrift, false);

  assert.equal(normalizeAdapter({}).entities.tracksDrift, false);
  assert.equal(normalizeAdapter().entities.tracksDrift, false);
});

console.log(`\ncontext.test.js: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
