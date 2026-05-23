/**
 * Tests for lib/host-election.js — instantiation + the solo-host path.
 * Timers are shortened via applySettings so the election resolves fast.
 * Run: node src/packages/realtime/tests/host-election.test.js
 */
import assert from 'node:assert/strict';
import { createHostElection } from '../lib/host-election.js';
import { applySettings } from '../lib/settings.js';

applySettings({ pingWaitMs: 10, claimWaitMs: 10, syncTimeoutMs: 20, hostLossMs: 50 });

function mockTransport(sid) {
  return {
    send: () => {},
    on: () => () => {},
    getPeers: () => new Map(),       // solo: no peers
    getSessionId: () => sid,
    onPeerJoin: () => () => {},
    onPeerLeave: () => () => {},
    onDisconnect: () => () => {},
  };
}

// A transport whose registered handlers can be driven from the test, so a
// host-confirmed collision (two self-elected hosts) can be exercised.
function controllableTransport(sid) {
  const handlers = new Map();
  const sent = [];
  return {
    send: (type, data) => sent.push([type, data]),
    on: (type, cb) => { handlers.set(type, cb); return () => handlers.delete(type); },
    getPeers: () => new Map(),
    getSessionId: () => sid,
    onPeerJoin: () => () => {},
    onPeerLeave: () => () => {},
    onDisconnect: () => () => {},
    _deliver: (type, data) => { const h = handlers.get(type); if (h) h(data); },
    _sent: sent,
  };
}

async function run() {
  let passed = 0, failed = 0;
  const test = async (name, fn) => {
    try { await fn(); passed++; console.log('  ok   -', name); }
    catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
  };

  await test('isHost() is false before init', () => {
    const el = createHostElection({ name: 'world', transport: mockTransport('me') });
    assert.equal(el.isHost(), false);
    assert.equal(el.getConfirmedHostId(), null);
  });

  await test('a solo peer (no pong replies) becomes host', async () => {
    const el = createHostElection({ name: 'world', transport: mockTransport('me') });
    const result = await el.init({});
    assert.equal(result.isHost, true);
    assert.equal(el.isHost(), true);
    assert.equal(el.getConfirmedHostId(), 'me');
  });

  await test('reset() clears host state', async () => {
    const el = createHostElection({ name: 'world', transport: mockTransport('me') });
    await el.init({});
    el.reset();
    assert.equal(el.isHost(), false);
    assert.equal(el.getConfirmedHostId(), null);
  });

  // Split-brain: two clients self-elect when their ping windows miss each
  // other. The collision must resolve deterministically - lower sid wins.
  await test('host resigns to a lower session id on a host-confirmed collision', async () => {
    const t = controllableTransport('zzz');
    const el = createHostElection({ name: 'world', transport: t });
    let resigned = false;
    await el.init({ onResign: () => { resigned = true; } });
    assert.equal(el.isHost(), true);
    t._deliver('world:host-confirmed', { sid: 'aaa' }); // lower id outranks us
    assert.equal(el.isHost(), false, 'the higher-id host must step down');
    assert.equal(resigned, true);
    assert.equal(el.getConfirmedHostId(), 'aaa');
  });

  await test('host keeps hosting and re-asserts against a higher session id', async () => {
    const t = controllableTransport('aaa');
    const el = createHostElection({ name: 'world', transport: t });
    await el.init({ onResign: () => { throw new Error('must not resign'); } });
    assert.equal(el.isHost(), true);
    t._sent.length = 0;
    t._deliver('world:host-confirmed', { sid: 'zzz' }); // we outrank it
    assert.equal(el.isHost(), true, 'the lower-id host must keep hosting');
    assert.ok(
      t._sent.some(([type]) => type === 'world:host-confirmed'),
      're-assert: a host-confirmed should be re-broadcast',
    );
  });

  console.log(`\nhost-election.test.js: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
run();
