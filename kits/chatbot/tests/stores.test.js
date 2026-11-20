/**
 * Tests for lib/stores.js: localStore against a stub localStorage, and the
 * calls functionStore makes.
 * Run: node tests/stores.test.js
 */
import assert from 'node:assert/strict';
import { localStore, functionStore } from '../lib/stores.js';

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

function stubLocalStorage({ quota = Infinity } = {}) {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (v.length > quota) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
      data.set(k, v);
    },
  };
  return data;
}

test('localStore keeps conversations, newest first, and rewrites tails', async () => {
  stubLocalStorage();
  const s = localStore('t');
  const { id: a } = await s.create({ title: 'A', messages: [{ role: 'user', content: '1' }] });
  await new Promise(r => setTimeout(r, 2));
  const { id: b } = await s.create({ title: 'B', messages: [] });
  assert.deepEqual((await s.list()).map(c => c.title), ['B', 'A']);
  await s.write(a, 1, [{ role: 'assistant', content: '2' }]);
  await s.write(a, 1, [{ role: 'assistant', content: '2b' }]);
  assert.deepEqual((await s.load(a)).messages.map(m => m.content), ['1', '2b']);
  await s.rename(b, 'Bee');
  assert.equal((await s.load(b)).title, 'Bee');
  await s.remove(a);
  assert.equal(await s.load(a), null);
});

test('localStore says so when the browser is out of space', async () => {
  stubLocalStorage({ quota: 50 });
  const s = localStore('t');
  await assert.rejects(s.create({ title: 'x', messages: [{ role: 'user', content: 'y'.repeat(100) }] }), /out of storage/);
});

test('functionStore sends each action to the one function', async () => {
  const calls = [];
  globalThis.Gipity = { fn: async (name, body) => { calls.push([name, body]); return body.action === 'list' ? { conversations: [] } : body.action === 'load' ? { conversation: null } : { id: 'c_1', ok: true }; } };
  const s = functionStore('chats');
  await s.list();
  await s.load('c_1');
  assert.deepEqual(await s.create({ title: 't', messages: [] }), { id: 'c_1', ok: true });
  await s.write('c_1', 2, [{ role: 'user', content: 'x' }]);
  await s.rename('c_1', 'n');
  await s.remove('c_1');
  assert.deepEqual(calls.map(c => c[1].action), ['list', 'load', 'create', 'write', 'rename', 'remove']);
  assert.ok(calls.every(c => c[0] === 'chats'));
  assert.deepEqual(calls[3][1], { action: 'write', id: 'c_1', from: 2, messages: [{ role: 'user', content: 'x' }] });
  delete globalThis.Gipity;
});

test('functionStore turns a function { error } into a thrown error', async () => {
  globalThis.Gipity = { fn: async () => ({ error: 'Conversation not found.' }) };
  await assert.rejects(functionStore('chats').load('c_x'), /Conversation not found/);
  delete globalThis.Gipity;
});

for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}
console.log('');
console.log(`stores.test.js: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
