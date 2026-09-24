/**
 * Tests for lib/reconnect.js (pure functions).
 * Run: node src/packages/realtime/tests/reconnect.test.js
 */
import assert from 'node:assert/strict';
import { reconnectDelay, isRoomGoneError } from '../lib/reconnect.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

test('reconnectDelay grows exponentially from the base', () => {
  assert.equal(reconnectDelay(1, { baseMs: 800, maxMs: 8000 }), 800);
  assert.equal(reconnectDelay(2, { baseMs: 800, maxMs: 8000 }), 1600);
  assert.equal(reconnectDelay(3, { baseMs: 800, maxMs: 8000 }), 3200);
  assert.equal(reconnectDelay(4, { baseMs: 800, maxMs: 8000 }), 6400);
});

test('reconnectDelay is capped at maxMs', () => {
  assert.equal(reconnectDelay(5, { baseMs: 800, maxMs: 8000 }), 8000);
  assert.equal(reconnectDelay(50, { baseMs: 800, maxMs: 8000 }), 8000);
});

test('reconnectDelay clamps attempt below 1 and has defaults', () => {
  assert.equal(reconnectDelay(0), 800);
  assert.equal(reconnectDelay(1), 800);
  assert.ok(reconnectDelay(99) <= 8000);
});

test('isRoomGoneError - permanent failures', () => {
  assert.equal(isRoomGoneError({ code: 4212 }), true);
  assert.equal(isRoomGoneError(new Error('room not found')), true);
  assert.equal(isRoomGoneError(new Error('room is locked')), true);
  assert.equal(isRoomGoneError(new Error('seat reservation expired')), true);
  assert.equal(isRoomGoneError(new Error('room disposed')), true);
});

test('isRoomGoneError - transient failures and junk', () => {
  assert.equal(isRoomGoneError(new Error('network timeout')), false);
  assert.equal(isRoomGoneError(new Error('ECONNRESET')), false);
  assert.equal(isRoomGoneError(null), false);
  assert.equal(isRoomGoneError(undefined), false);
  assert.equal(isRoomGoneError({}), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
