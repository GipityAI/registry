/**
 * Tests for lib/gestures.js - the pure gesture-commit gate.
 * Run: node src/packages/web-vision-mediapipe/tests/gestures.test.js
 *
 * No browser needed: the gate takes an explicit clock, and a frame result is
 * just the MediaPipe shape { gestures: [[{ categoryName, score }]] }.
 */
import assert from 'node:assert/strict';
import { gestureName, createGestureGate } from '../lib/gestures.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

/** A frame where the model saw `name` with `score`. */
const frame = (name, score = 0.9) => ({ gestures: name ? [[{ categoryName: name, score }]] : [] });

test('gestureName pulls the top label out of a frame', () => {
  assert.equal(gestureName(frame('Victory')), 'Victory');
});

test("gestureName treats the model's 'None' as no gesture", () => {
  assert.equal(gestureName(frame('None')), null);
});

test('gestureName ignores a low-confidence label, and an empty frame', () => {
  assert.equal(gestureName(frame('Open_Palm', 0.2)), null);
  assert.equal(gestureName(frame(null)), null);
});

test('gate commits only after the pose is held for holdMs', () => {
  const gate = createGestureGate({ holdMs: 500 });
  assert.equal(gate.read(frame('Closed_Fist'), 0), null);
  assert.equal(gate.read(frame('Closed_Fist'), 400), null);
  assert.equal(gate.read(frame('Closed_Fist'), 500), 'Closed_Fist');
});

test('a held pose commits exactly once', () => {
  const gate = createGestureGate({ holdMs: 100 });
  gate.read(frame('Open_Palm'), 0);
  assert.equal(gate.read(frame('Open_Palm'), 100), 'Open_Palm');
  assert.equal(gate.read(frame('Open_Palm'), 200), null);
  assert.equal(gate.read(frame('Open_Palm'), 5000), null);
});

test('a flickering hand never commits', () => {
  const gate = createGestureGate({ holdMs: 100 });
  const seen = [
    gate.read(frame('Closed_Fist'), 0),
    gate.read(frame('Victory'), 60),
    gate.read(frame('Open_Palm'), 120),
    gate.read(frame('Victory'), 180),
  ];
  assert.deepEqual(seen, [null, null, null, null]);
});

test('changing the pose arms the next commit', () => {
  const gate = createGestureGate({ holdMs: 100 });
  gate.read(frame('Closed_Fist'), 0);
  assert.equal(gate.read(frame('Closed_Fist'), 100), 'Closed_Fist');
  gate.read(frame('Victory'), 200);
  assert.equal(gate.read(frame('Victory'), 300), 'Victory');
});

test('the same pose can be thrown twice if the hand drops in between', () => {
  const gate = createGestureGate({ holdMs: 100 });
  gate.read(frame('Victory'), 0);
  assert.equal(gate.read(frame('Victory'), 100), 'Victory');
  gate.read(frame(null), 150);                                  // hand out of shot
  gate.read(frame('Victory'), 200);
  assert.equal(gate.read(frame('Victory'), 300), 'Victory');
});

test('reset drops an in-progress hold', () => {
  const gate = createGestureGate({ holdMs: 100 });
  gate.read(frame('Open_Palm'), 0);
  gate.reset();
  assert.equal(gate.holding(), null);
  assert.equal(gate.read(frame('Open_Palm'), 100), null);       // hold restarts from here
  assert.equal(gate.read(frame('Open_Palm'), 200), 'Open_Palm');
});

test('holding/committed report the live state', () => {
  const gate = createGestureGate({ holdMs: 100 });
  gate.read(frame('Thumb_Up'), 0);
  assert.equal(gate.holding(), 'Thumb_Up');
  assert.equal(gate.committed(), null);
  gate.read(frame('Thumb_Up'), 100);
  assert.equal(gate.committed(), 'Thumb_Up');
});

test('stable() is null until the pose has been held for holdMs', () => {
  const gate = createGestureGate({ holdMs: 100 });
  assert.equal(gate.stable(), null);
  gate.read(frame('Victory'), 0);
  assert.equal(gate.stable(), null);         // seen, not yet settled
  gate.read(frame('Victory'), 100);
  assert.equal(gate.stable(), 'Victory');
});

test('stable() keeps reporting a held pose long after it committed', () => {
  const gate = createGestureGate({ holdMs: 100 });
  gate.read(frame('Open_Palm'), 0);
  gate.read(frame('Open_Palm'), 100);
  gate.read(frame('Open_Palm'), 9000);
  assert.equal(gate.stable(), 'Open_Palm');  // the pull side has no once-only rule
});

test('stable() drops to null the moment the hand changes or leaves', () => {
  const gate = createGestureGate({ holdMs: 100 });
  gate.read(frame('Closed_Fist'), 0);
  gate.read(frame('Closed_Fist'), 100);
  gate.read(frame('Victory'), 110);          // mid-change: not settled on anything
  assert.equal(gate.stable(), null);
  gate.read(frame(null), 150);               // hand out of shot
  assert.equal(gate.stable(), null);
});

// The bug the pull side exists to prevent: a player throws rock two rounds
// running. onGesture fires only for round one, so a game that cached the last
// event would score round two off a stale throw. stable() still reads rock.
test('the same pose held across two rounds pushes once but polls every time', () => {
  const gate = createGestureGate({ holdMs: 100 });
  const pushed = [];
  const sample = (t) => { const e = gate.read(frame('Closed_Fist'), t); if (e) pushed.push(e); };

  sample(0);
  sample(100);                               // round one: settles, fires
  assert.equal(gate.stable(), 'Closed_Fist');
  sample(2000);                              // round two: same hand, no new event
  assert.equal(gate.stable(), 'Closed_Fist');
  assert.deepEqual(pushed, ['Closed_Fist']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
