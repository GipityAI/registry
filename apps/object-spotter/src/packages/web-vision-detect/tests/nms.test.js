/**
 * Tests for lib/nms.js - synthetic overlap cases.
 * Run: node src/packages/web-vision-detect/tests/nms.test.js
 */
import assert from 'node:assert/strict';
import { nms } from '../lib/nms.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

const box = (x1, y1, x2, y2, score, classId) => ({ x1, y1, x2, y2, score, classId });

test('suppresses a heavily-overlapping same-class box, keeps the higher score', () => {
  const kept = nms([
    box(0, 0, 100, 100, 0.9, 0),
    box(5, 5, 105, 105, 0.8, 0),
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].score, 0.9);
});

test('keeps overlapping boxes of different classes', () => {
  const kept = nms([
    box(0, 0, 100, 100, 0.9, 16),  // dog
    box(5, 5, 105, 105, 0.8, 1),   // bicycle, same spot
  ]);
  assert.equal(kept.length, 2);
});

test('keeps same-class boxes below the IoU threshold', () => {
  const kept = nms([
    box(0, 0, 100, 100, 0.9, 0),
    box(200, 200, 300, 300, 0.8, 0),
  ]);
  assert.equal(kept.length, 2);
});

test('result is sorted by descending score regardless of input order', () => {
  const kept = nms([
    box(200, 200, 300, 300, 0.6, 0),
    box(0, 0, 100, 100, 0.9, 0),
  ]);
  assert.deepEqual(kept.map((k) => k.score), [0.9, 0.6]);
});

test('maxDetections caps the survivors, best first', () => {
  const many = Array.from({ length: 10 }, (_, i) => box(i * 200, 0, i * 200 + 100, 100, (i + 1) / 10, 0));
  const kept = nms(many, { maxDetections: 3 });
  assert.equal(kept.length, 3);
  assert.deepEqual(kept.map((k) => k.score), [1.0, 0.9, 0.8]);
});

test('empty input -> empty output', () => {
  assert.deepEqual(nms([]), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
