/**
 * Tests for lib/clock.js (pure clock-sync math) and the messages channel's
 * targeted sends / sentAt stamping.
 * Run: node src/packages/realtime/tests/clock.test.js
 */
import assert from 'node:assert/strict';
import { createClock } from '../lib/clock.js';
import { createChannelRegistry } from '../lib/channels.js';
import { createObservability } from '../lib/observability.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

test('offset comes from the lowest-RTT sample', () => {
  const c = createClock();
  assert.equal(c.isSynced(), false);
  assert.equal(c.offset(), 0);
  // local t=1000, server replied 5000 after 100ms: offset = 5000 - 1050 = 3950
  c.addSample(1000, 5000, 1100);
  assert.equal(c.offset(), 3950);
  // a slower sample (rtt 400) must not win over the faster one
  c.addSample(2000, 6100, 2400);
  assert.equal(c.offset(), 3950);
  // a faster one (rtt 20) takes over: 7000 - (3000 + 10) = 3990
  c.addSample(3000, 7000, 3020);
  assert.equal(c.offset(), 3990);
  assert.equal(c.rtt(), 20);
  assert.equal(c.minRtt(), 20);
  assert.equal(c.toServer(10_000), 13_990);
});

test('only the last `window` samples count', () => {
  const c = createClock({ window: 2 });
  c.addSample(0, 100, 10);       // rtt 10, offset 95
  c.addSample(0, 200, 50);       // rtt 50
  c.addSample(0, 300, 60);       // rtt 60 -> the rtt-10 sample aged out
  assert.equal(c.minRtt(), 50);
});

test('garbage and time-travel samples are ignored', () => {
  const c = createClock();
  assert.equal(c.addSample(undefined, 5, 10), null);
  assert.equal(c.addSample(100, 'x', 110), null);
  assert.equal(c.addSample(100, 500, 50), null);   // "now" before send
  assert.equal(c.isSynced(), false);
});

function fakeTransport({ synced = true } = {}) {
  const sent = [];
  return {
    sent,
    send: (type, data, opts) => sent.push({ type, data, opts }),
    on: () => () => {},
    isConnected: () => true,
    isClockSynced: () => synced,
    serverNow: () => 123_456.7,
  };
}

test('messages channel: to / sendToHost pass the target through', () => {
  const t = fakeTransport();
  const ch = createChannelRegistry({ transport: t, observability: createObservability() }).channel('input');
  ch.send('press', { key: 'a' }, { to: 'sid-1' });
  ch.sendToHost('press', { key: 'b' });
  ch.send('press', { key: 'c' });
  assert.deepEqual(t.sent.map((m) => [m.type, m.opts?.to]), [['input:press', 'sid-1'], ['input:press', 'host'], ['input:press', undefined]]);
});

test('messages channel stamps sentAt in server time once synced, never overriding the app', () => {
  const t = fakeTransport();
  const ch = createChannelRegistry({ transport: t, observability: createObservability() }).channel('input');
  ch.send('press', { key: 'a' });
  ch.send('press', { key: 'b', sentAt: 5 });
  assert.equal(t.sent[0].data.sentAt, 123_457);
  assert.equal(t.sent[1].data.sentAt, 5);
  const unsynced = fakeTransport({ synced: false });
  createChannelRegistry({ transport: unsynced, observability: createObservability() }).channel('x').send('y', { z: 1 });
  assert.equal('sentAt' in unsynced.sent[0].data, false);
});

console.log(`\nclock.test.js: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
