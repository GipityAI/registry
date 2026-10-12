/**
 * Tests for lib/no-telemetry.js - MediaPipe's metrics requests never reach
 * the network, everything else passes through.
 * Run: node src/packages/web-vision-mediapipe/tests/no-telemetry.test.js
 */
import assert from 'node:assert/strict';
import { blockMediaPipeTelemetry, TELEMETRY_HOST } from '../lib/no-telemetry.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

// A stand-in for window: records every request that would hit the network.
function fakeWindow() {
  const sent = [];
  return {
    sent,
    fetch(input) { sent.push(typeof input === 'string' ? input : input.url); return Promise.resolve(new Response('real')); },
  };
}

// The exact call MediaPipe 1.x makes from its task logger.
const METRICS_URL = `https://${TELEMETRY_HOST}/v1/log`;

await test('the metrics POST is answered locally and never sent', async () => {
  const win = fakeWindow();
  blockMediaPipeTelemetry(win);
  const res = await win.fetch(METRICS_URL, { method: 'POST', body: new Uint8Array([1, 2, 3]) });
  assert.equal(res.status, 204);
  assert.deepEqual(win.sent, []);
});

await test('a Request object to the metrics host is blocked too', async () => {
  const win = fakeWindow();
  blockMediaPipeTelemetry(win);
  await win.fetch(new Request(METRICS_URL, { method: 'POST' }));
  assert.deepEqual(win.sent, []);
});

await test('model, WASM and app requests pass through unchanged', async () => {
  const win = fakeWindow();
  blockMediaPipeTelemetry(win);
  const urls = [
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm/vision_wasm_internal.wasm',
    '/api/thing',
  ];
  for (const url of urls) assert.equal(await (await win.fetch(url)).text(), 'real');
  assert.deepEqual(win.sent, urls);
});

await test('installing twice wraps fetch once', async () => {
  const win = fakeWindow();
  blockMediaPipeTelemetry(win);
  const once = win.fetch;
  blockMediaPipeTelemetry(win);
  assert.equal(win.fetch, once);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
