/**
 * Tests for lib/errors.js - join-failure classification.
 * Run: node src/packages/realtime/tests/errors.test.js
 */
import assert from 'node:assert/strict';
import { RealtimeJoinError, classifyJoinError, toJoinError } from '../lib/errors.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

const err = (message, code) => Object.assign(new Error(message), code !== undefined ? { code } : {});

test('no error at all means offline (no app GUID)', () => {
  assert.equal(classifyJoinError(null), 'offline');
  assert.equal(classifyJoinError(undefined), 'offline');
});

test('4212 "is locked" is a full table', () => {
  assert.equal(classifyJoinError(err('room "abc" is locked', 4212)), 'full');
});

test('4212 "not found" is a gone room', () => {
  assert.equal(classifyJoinError(err('room "abc" not found', 4212)), 'gone');
});

test('4211 join-only miss is not-found', () => {
  assert.equal(classifyJoinError(err('no rooms found with provided criteria', 4211)), 'not-found');
});

test('disposed / not available message text maps to gone', () => {
  assert.equal(classifyJoinError(err('room "x" has been disposed.')), 'gone');
  assert.equal(classifyJoinError(err('room not available')), 'gone');
});

test('token problems map to auth', () => {
  assert.equal(classifyJoinError(err('token fetch failed: 403')), 'auth');
  assert.equal(classifyJoinError(err('Invalid app token')), 'auth');
});

test('user-room session rejections map to auth (fail fast, never retried)', () => {
  assert.equal(classifyJoinError(err('Room requires Gipity login - pass sessionId in join options')), 'auth');
  assert.equal(classifyJoinError(err('Invalid or expired Gipity session')), 'auth');
});

test('4216 identity/config rejections are permanent, typed codes', () => {
  assert.equal(classifyJoinError(err('Room instance belongs to a different app, room, or scope', 4216)), 'not-found');
  assert.equal(classifyJoinError(err('Room type mismatch - expected state', 4216)), 'unprovisioned');
});

test('anything else is failed', () => {
  assert.equal(classifyJoinError(err('socket hang up')), 'failed');
});

test('an unprovisioned room name gets its own code', () => {
  assert.equal(classifyJoinError(err("Room 'standup' not found for this project")), 'unprovisioned');
});

test('server messages echoing tricky room names do not misclassify', () => {
  // The name contains "locked" but the condition is unprovisioned / gone.
  assert.equal(classifyJoinError(err("Room 'locked-door' not found for this project")), 'unprovisioned');
  assert.equal(classifyJoinError(err('room "locked-door" has been disposed.')), 'gone');
});

test('toJoinError wraps with context and is idempotent', () => {
  const wrapped = toJoinError(err('room "abc" is locked', 4212), 'joining table Q7 failed');
  assert.ok(wrapped instanceof RealtimeJoinError);
  assert.equal(wrapped.code, 'full');
  assert.match(wrapped.message, /joining table Q7 failed/);
  assert.equal(toJoinError(wrapped), wrapped);
});

console.log(`\nerrors.test.js: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
