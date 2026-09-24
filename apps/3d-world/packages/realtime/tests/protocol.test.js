/**
 * Tests for lib/protocol.js (pure functions).
 * Run: node src/packages/realtime/tests/protocol.test.js
 */
import assert from 'node:assert/strict';
import { quantize, evaluateHost, chunkInit, assembleChunks, computeDrift } from '../lib/protocol.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

test('quantize rounds to precision', () => {
  assert.equal(quantize(1.2345, 0.01), 1.23);
  assert.equal(quantize(1.236, 0.01), 1.24);
  assert.equal(quantize(-0.004, 0.01), -0);
});

test('evaluateHost picks alphabetically lowest id deterministically', () => {
  assert.deepEqual(evaluateHost('a', ['b', 'c']), { isHost: true, playerNumber: 1, totalPlayers: 3 });
  assert.deepEqual(evaluateHost('b', ['a', 'c']), { isHost: false, playerNumber: 2, totalPlayers: 3 });
  assert.deepEqual(evaluateHost('solo', []), { isHost: true, playerNumber: 1, totalPlayers: 1 });
  // order of remoteIds must not matter
  assert.deepEqual(evaluateHost('m', ['z', 'a']), evaluateHost('m', ['a', 'z']));
});

test('chunkInit + assembleChunks round-trip', () => {
  const rows = Array.from({ length: 37 }, (_, i) => [String(i), i]);
  const chunks = chunkInit(rows, 15);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].totalChunks, 3);
  assert.equal(chunks[0].total, 37);
  const acc = new Map();
  let out = null;
  for (const c of chunks) { const r = assembleChunks(c, acc); if (r) out = r; }
  assert.equal(out.length, 37);
  assert.deepEqual(out[36], ['36', 36]);
});

test('chunkInit handles an empty row set', () => {
  const chunks = chunkInit([], 15);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].total, 0);
  assert.deepEqual(chunks[0].rows, []);
});

test('computeDrift is euclidean distance', () => {
  assert.equal(computeDrift({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 5);
  assert.equal(computeDrift({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }), 0);
});

console.log(`\nprotocol.test.js: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
