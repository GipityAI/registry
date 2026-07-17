/**
 * Tests for scripts/lib/servicenow-realtime-setup.js (the connect-realtime.mjs
 * setup script's pure logic). Run: node kits/integrations/servicenow/tests/servicenow-realtime-setup.test.js
 */
import { ensureWebhookProperties, ensureScriptInclude, ensureBusinessRule, SCRIPT_INCLUDE_BODY } from '../scripts/lib/servicenow-realtime-setup.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}
const assertEq = (actual, expected, msg) => {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

function makeFetch(responder) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    const { status = 200, body = {} } = responder(url, opts);
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { fetch, calls };
}

console.log('servicenow-realtime-setup');

await test('SCRIPT_INCLUDE_BODY sends { secret, record } as the webhook body, not a header', () => {
  if (!SCRIPT_INCLUDE_BODY.includes("JSON.stringify({ secret: webhookSecret, record: record })")) {
    throw new Error('script include body does not embed the secret in the JSON payload');
  }
  if (SCRIPT_INCLUDE_BODY.includes('x-gipity-secret')) {
    throw new Error('script include body still uses a custom header - the runtime strips unlisted headers');
  }
});

await test('ensureWebhookProperties creates both properties when absent', async () => {
  const { fetch, calls } = makeFetch(() => ({ body: { result: [] } })); // every GET: not found
  const result = await ensureWebhookProperties(fetch, 'https://x', 'auth', {
    webhookUrl: 'https://a.gipity.ai/api/p1/fn/sn-webhook', webhookSecret: 'sek',
  });
  assertEq(result.url, 'created', 'url result');
  assertEq(result.secret, 'created', 'secret result');
  const posts = calls.filter(c => c.opts.method === 'POST');
  assertEq(posts.length, 2, 'POST calls');
});

await test('ensureWebhookProperties updates (rotates) existing properties', async () => {
  const { fetch, calls } = makeFetch(() => ({ body: { result: [{ sys_id: 'p1' }] } })); // every GET: found
  const result = await ensureWebhookProperties(fetch, 'https://x', 'auth', {
    webhookUrl: 'https://a.gipity.ai/api/p1/fn/sn-webhook', webhookSecret: 'sek2',
  });
  assertEq(result.url, 'updated', 'url result');
  assertEq(result.secret, 'updated', 'secret result');
  const patches = calls.filter(c => c.opts.method === 'PATCH');
  assertEq(patches.length, 2, 'PATCH calls');
});

await test('ensureScriptInclude creates when absent, updates when present', async () => {
  let getCalled = false;
  const { fetch, calls } = makeFetch((url, opts) => {
    if (opts?.method === undefined || opts.method === 'GET') {
      const found = getCalled;
      getCalled = true;
      return { body: { result: found ? [{ sys_id: 'si1' }] : [] } };
    }
    return { body: { result: { sys_id: 'si1' } } };
  });
  const first = await ensureScriptInclude(fetch, 'https://x', 'auth');
  assertEq(first, 'created', 'first run');
  const second = await ensureScriptInclude(fetch, 'https://x', 'auth');
  assertEq(second, 'updated', 'second run');
  const create = calls.find(c => c.opts.method === 'POST');
  if (!JSON.parse(create.opts.body).script.includes('sn_ws.RESTMessageV2')) throw new Error('script include payload missing the REST call');
});

await test('ensureBusinessRule sets the loop-prevention condition and async_always timing', async () => {
  const { fetch, calls } = makeFetch(() => ({ body: { result: [] } }));
  const result = await ensureBusinessRule(fetch, 'https://x', 'auth', { table: 'incident', integrationUsername: 'gipity.integration' });
  assertEq(result, 'created', 'result');
  const create = calls.find(c => c.opts.method === 'POST');
  const payload = JSON.parse(create.opts.body);
  assertEq(payload.collection, 'incident', 'collection');
  assertEq(payload.when, 'async_always', 'when');
  assertEq(payload.condition, "gs.getUserName() != 'gipity.integration'", 'condition');
  assertEq(payload.action_delete, 'false', 'action_delete');
  if (!payload.script.includes('new GipitySync().pushRecord(current)')) throw new Error('business rule script missing the pushRecord call');
});

await test('ensureBusinessRule escapes a single quote in the integration username', async () => {
  const { fetch, calls } = makeFetch(() => ({ body: { result: [] } }));
  await ensureBusinessRule(fetch, 'https://x', 'auth', { table: 'incident', integrationUsername: "o'brien" });
  const create = calls.find(c => c.opts.method === 'POST');
  const payload = JSON.parse(create.opts.body);
  assertEq(payload.condition, "gs.getUserName() != 'o\\'brien'", 'escaped condition');
});

await test('ensureBusinessRule reuses an existing rule by name (idempotent)', async () => {
  const { fetch, calls } = makeFetch(() => ({ body: { result: [{ sys_id: 'br1' }] } }));
  const result = await ensureBusinessRule(fetch, 'https://x', 'auth', { table: 'problem', integrationUsername: 'gipity.integration' });
  assertEq(result, 'updated', 'result');
  const patch = calls.find(c => c.url.endsWith('/sys_script/br1'));
  if (!patch || patch.opts.method !== 'PATCH') throw new Error('expected a PATCH to the existing rule');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
