/**
 * Tests for lib/channels.js — channel registry, namespacing, mode dispatch.
 * Uses a mock transport so no network is needed.
 * Run: node src/packages/realtime/tests/channels.test.js
 */
import assert from 'node:assert/strict';
import { createChannelRegistry } from '../lib/channels.js';
import { createObservability } from '../lib/observability.js';

function mockTransport() {
  const handlers = new Map();
  const sent = [];
  return {
    isConnected: () => false,
    send: (type, data) => sent.push([type, data]),
    on: (type, cb) => { handlers.set(type, cb); return () => handlers.delete(type); },
    setData: () => {}, deleteData: () => {},
    onData: () => () => {},
    onPeerJoin: () => () => {}, onPeerLeave: () => () => {}, onDisconnect: () => () => {},
    getPeers: () => new Map(), getSessionId: () => 'me',
    _sent: sent, _handlers: handlers,
  };
}
const newReg = () => createChannelRegistry({ transport: mockTransport(), observability: createObservability() });

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

test('messages channel namespaces the wire type with "<name>:"', () => {
  const t = mockTransport();
  const reg = createChannelRegistry({ transport: t, observability: createObservability() });
  reg.channel('chat', { sync: 'messages' }).send('msg', { text: 'hi' });
  assert.deepEqual(t._sent[0], ['chat:msg', { text: 'hi' }]);
});

test('rejects reserved and malformed channel names', () => {
  const reg = newReg();
  assert.throws(() => reg.channel('set_data', {}));
  assert.throws(() => reg.channel('delete_data', {}));
  assert.throws(() => reg.channel('a:b', {}));
  assert.throws(() => reg.channel('', {}));
});

test('same name returns the identical channel object', () => {
  const reg = newReg();
  assert.equal(reg.channel('x', { sync: 'messages' }), reg.channel('x', { sync: 'messages' }));
});

test('dispatches each sync mode', () => {
  const reg = newReg();
  assert.equal(reg.channel('m', { sync: 'messages' }).sync, 'messages');
  assert.equal(reg.channel('p', { sync: 'presence' }).sync, 'presence');
  const e = reg.channel('e', { sync: 'entities', authority: 'shared' });
  assert.equal(e.sync, 'entities');
  assert.equal(e.authority, 'shared');
});

test('unknown sync mode throws', () => {
  assert.throws(() => newReg().channel('bad', { sync: 'nope' }));
});

test('entities channel exposes CRUD surface', () => {
  const ch = newReg().channel('cards', { sync: 'entities', authority: 'server' });
  for (const m of ['upsert', 'delete', 'get', 'all', 'onUpsert', 'onDelete', 'onReady']) {
    assert.equal(typeof ch[m], 'function', `missing ${m}`);
  }
});

test('store channel exposes the key-value surface', () => {
  const ch = newReg().channel('s', { sync: 'store' });
  assert.equal(ch.sync, 'store');
  for (const m of ['get', 'set', 'update', 'delete', 'has', 'all', 'onChange', 'onReady']) {
    assert.equal(typeof ch[m], 'function', `missing ${m}`);
  }
  assert.equal(ch.isHost, undefined); // a shared store has no host surface
});

test('host store adds the authority surface', () => {
  const ch = newReg().channel('g', { sync: 'store', authority: 'host' });
  assert.equal(ch.authority, 'host');
  for (const m of ['isHost', 'command', 'onCommand', 'onHost']) {
    assert.equal(typeof ch[m], 'function', `missing ${m}`);
  }
});

console.log(`\nchannels.test.js: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
