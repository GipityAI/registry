/**
 * Tests for lib/loop.js - the pure FPS counter.
 * Run: node src/packages/web-vision-mediapipe/tests/loop.test.js
 *
 * createLoop itself needs a browser (requestAnimationFrame, a <video>), so
 * only the time-based math in createFps is unit-tested here.
 */
import assert from 'node:assert/strict';
import { createFps } from '../lib/loop.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

// Busy-wait a real, measurable interval (createFps reads performance.now()).
function spin(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) { /* burn */ }
}

test('value is 0 before any ticks', () => {
  assert.equal(createFps().value(), 0);
});

test('value stays 0 after a single tick (needs an interval)', () => {
  const fps = createFps();
  fps.tick();
  assert.equal(fps.value(), 0);
});

test('value is a positive finite number once intervals exist', () => {
  const fps = createFps();
  fps.tick();
  spin(25);
  fps.tick();
  spin(25);
  fps.tick();
  const v = fps.value();
  assert.ok(Number.isFinite(v), `expected finite, got ${v}`);
  assert.ok(v > 0, `expected > 0, got ${v}`);
});

test('reset clears samples back to 0', () => {
  const fps = createFps();
  fps.tick();
  spin(10);
  fps.tick();
  assert.ok(fps.value() > 0);
  fps.reset();
  assert.equal(fps.value(), 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
