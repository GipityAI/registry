/**
 * Tests for lib/decode.js + lib/nms.js against a golden fixture.
 * Run: node src/packages/web-vision-detect/tests/decode.test.js
 *
 * The fixture is the *raw* yolox_nano (416x416) output tensor captured from
 * onnxruntime on the classic dog/bicycle/car test photo (768x576), plus the
 * detections the official YOLOX reference decode (numpy demo_postprocess +
 * class-wise NMS) produced for it. If our JS decode drifts from the
 * reference - grid order, exp/stride math, NMS - this fails.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGrids, decodeYolox, letterboxParams, mapToSource } from '../lib/decode.js';
import { nms } from '../lib/nms.js';
import { COCO_LABELS } from '../lib/labels.js';

const here = dirname(fileURLToPath(import.meta.url));
const raw = new Float32Array(readFileSync(join(here, 'fixtures/yolox-nano-416-output.bin')).buffer);
const golden = JSON.parse(readFileSync(join(here, 'fixtures/yolox-nano-416-expected.json'), 'utf8'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

test('makeGrids covers strides 8/16/32 in output order', () => {
  const g = makeGrids(416);
  assert.equal(g.count, 52 * 52 + 26 * 26 + 13 * 13); // 3549
  // First anchor: stride-8 cell (0,0); last: stride-32 cell (12,12).
  assert.equal(g.stride[0], 8);
  assert.equal(g.gx[0], 0);
  assert.equal(g.stride[g.count - 1], 32);
  assert.equal(g.gx[g.count - 1], 12);
  assert.equal(g.gy[g.count - 1], 12);
  // Stride-16 block starts right after the 2704 stride-8 anchors, at cell (0,0).
  assert.equal(g.stride[2704], 16);
  assert.equal(g.gx[2704], 0);
  // Row-major within a block: anchor 1 is cell (1,0).
  assert.equal(g.gx[1], 1);
  assert.equal(g.gy[1], 0);
});

test('decode + nms reproduces the reference detections', () => {
  const grids = makeGrids(golden.inputSize);
  const candidates = decodeYolox(raw, grids, { numClasses: 80, scoreThreshold: golden.scoreThreshold });
  const kept = nms(candidates, { iouThreshold: golden.iouThreshold });

  assert.equal(kept.length, golden.expected.length, `expected ${golden.expected.length} detections, got ${kept.length}`);
  // Both lists are score-descending; compare pairwise.
  golden.expected.forEach((exp, i) => {
    const got = kept[i];
    assert.equal(got.classId, exp.classId, `det ${i}: class ${COCO_LABELS[got.classId]} != ${exp.class}`);
    assert.ok(Math.abs(got.score - exp.score) < 1e-3, `det ${i} score ${got.score} != ${exp.score}`);
    const [x1, y1, x2, y2] = exp.box;
    for (const [g, e] of [[got.x1, x1], [got.y1, y1], [got.x2, x2], [got.y2, y2]]) {
      assert.ok(Math.abs(g - e) < 0.05, `det ${i} box ${g} != ${e}`);
    }
  });
});

test('decodeYolox rejects a mismatched tensor size', () => {
  assert.throws(() => decodeYolox(raw, makeGrids(640), { numClasses: 80, scoreThreshold: 0.5 }));
});

test('letterboxParams matches the fixture geometry (top-left pad)', () => {
  const box = letterboxParams(golden.imageWidth, golden.imageHeight, golden.inputSize, false);
  assert.ok(Math.abs(box.ratio - golden.ratio) < 1e-9);
  assert.equal(box.padX, 0);
  assert.equal(box.padY, 0);
  assert.equal(box.drawWidth, 416);
  assert.equal(box.drawHeight, 312);
});

test('letterboxParams centers when asked (Ultralytics convention)', () => {
  const box = letterboxParams(1280, 720, 640, true);
  assert.equal(box.drawWidth, 640);
  assert.equal(box.drawHeight, 360);
  assert.equal(box.padX, 0);
  assert.equal(box.padY, 140);
});

test('mapToSource scales boxes back to image pixels and clamps', () => {
  const box = letterboxParams(golden.imageWidth, golden.imageHeight, golden.inputSize, false);
  const dets = mapToSource(
    [{ x1: -5, y1: 112.12, x2: 175.82, y2: 293.72, score: 0.9, classId: 16 }],
    { ...box, srcWidth: golden.imageWidth, srcHeight: golden.imageHeight },
  );
  assert.equal(dets[0].x, 0); // clamped
  assert.ok(Math.abs(dets[0].y - 112.12 / golden.ratio) < 0.01);
  assert.ok(Math.abs((dets[0].y + dets[0].height) - 293.72 / golden.ratio) < 0.01);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
