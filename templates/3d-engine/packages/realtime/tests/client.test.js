/**
 * Tests for lib/client.js acquireUserTicket: how a signed-in page trades its
 * session (cookie + app token, or a Bearer player token) for a realtime user
 * ticket, and the typed errors when it can't. fetch is stubbed.
 * Run: node tests/client.test.js
 */
import assert from 'node:assert/strict';
import { createClient } from '../lib/client.js';

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

/** Stub fetch: answers by path, records each request. */
function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const r = routes[path];
    if (!r) throw new Error('network down');
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  return calls;
}

function client() {
  const c = createClient();
  c.configure({ appGuid: 'p_app1', apiBase: 'https://api.test' });
  return c;
}

test('cookie path: sends the app token, includes credentials, returns the ticket', async () => {
  const calls = stubFetch({
    '/api/token': { status: 200, body: { data: { token: 'app-tok' } } },
    '/api/p_app1/realtime/ticket': { status: 200, body: { data: { ticket: 'tk1', expiresIn: 300 } } },
  });
  assert.equal(await client().acquireUserTicket(), 'tk1');
  const req = calls.find((c) => c.url.endsWith('/realtime/ticket'));
  assert.equal(req.init.method, 'POST');
  assert.equal(req.init.credentials, 'include');
  assert.equal(req.init.headers['X-App-Token'], 'app-tok');
  assert.equal(req.init.headers.Authorization, undefined);
});

test('userToken path: sends it as Bearer and skips the app token', async () => {
  const calls = stubFetch({ '/api/p_app1/realtime/ticket': { status: 200, body: { data: { ticket: 'tk2' } } } });
  assert.equal(await client().acquireUserTicket('player-tok'), 'tk2');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer player-tok');
});

test('not signed in is a RealtimeJoinError with code auth', async () => {
  stubFetch({
    '/api/token': { status: 200, body: { data: { token: 'app-tok' } } },
    '/api/p_app1/realtime/ticket': { status: 401, body: { error: { code: 'UNAUTHORIZED' } } },
  });
  await assert.rejects(client().acquireUserTicket(), (e) => e.name === 'RealtimeJoinError' && e.code === 'auth');
});

test('a network failure is code offline', async () => {
  stubFetch({});
  await assert.rejects(client().acquireUserTicket('x'), (e) => e.code === 'offline');
});

test('getDefaultRoom reads the deploy-stamped gipity-realtime-room meta; null without one', async () => {
  const metas = { 'meta[name="gipity-realtime-room"]': { content: 'my-game' } };
  globalThis.document = { querySelector: (sel) => metas[sel] ?? null };
  try {
    assert.equal(createClient().getDefaultRoom(), 'my-game');
    delete metas['meta[name="gipity-realtime-room"]'];
    assert.equal(createClient().getDefaultRoom(), null);
  } finally {
    delete globalThis.document;
  }
  assert.equal(createClient().getDefaultRoom(), null, 'no document (not a browser)');
});

for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL ${name}\n       ${e.stack}`); }
}
console.log(`client: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
