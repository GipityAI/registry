/**
 * Tests for lib/labels.js - the per-label tally behind vision.counts().
 * Run: node src/packages/web-vision-detect/tests/labels.test.js
 */
import assert from 'node:assert/strict';
import { countLabels, COCO_LABELS } from '../lib/labels.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

test('tallies detections per label', () => {
  const dets = [{ label: 'person' }, { label: 'bus' }, { label: 'person' }, { label: 'person' }];
  assert.deepEqual(countLabels(dets), { person: 3, bus: 1 });
});

test('an empty frame is an empty tally', () => {
  assert.deepEqual(countLabels([]), {});
});

test('ships the 80 COCO labels', () => {
  assert.equal(COCO_LABELS.length, 80);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
