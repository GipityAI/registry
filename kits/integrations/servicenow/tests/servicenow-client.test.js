/**
 * Tests for functions/_lib/servicenow-client.js.
 * Run: node kits/integrations/servicenow/tests/servicenow-client.test.js
 *
 * `secrets` and `env` are ambient globals inside the real function sandbox
 * (never imported) - this harness stands one up on globalThis before
 * importing the module, same as the sandbox would inject them.
 *
 * The module keeps a module-level token cache, so each test that needs to
 * observe a fresh token fetch imports its own instance via a cache-busting
 * query string (Node's ESM loader treats a different specifier as a distinct
 * module, giving it fresh top-level state) rather than sharing one import.
 */
globalThis.secrets = {
  config: { SERVICENOW_INSTANCE_URL: 'https://dev12345.service-now.com', SERVICENOW_CLIENT_ID: 'cid', SERVICENOW_CLIENT_SECRET: 'csecret' },
  async get(name) { return this.config[name] ?? null; },
};

let importCounter = 0;
async function freshClient() {
  return import(`../functions/_lib/servicenow-client.js?t=${importCounter++}`);
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}
const assertEq = (actual, expected, msg) => {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

/** Stub WHATWG-shaped fetch, records every call. */
function makeFetch(responder) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    const { status = 200, body = {} } = responder(url, opts);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return { fetch, calls };
}

console.log('servicenow-client');

await test('getAccessToken posts a client_credentials grant and returns the token', async () => {
  const { getAccessToken } = await freshClient();
  const { fetch, calls } = makeFetch(() => ({ body: { access_token: 'tok_1', expires_in: 1800 } }));
  const token = await getAccessToken(fetch);
  assertEq(token, 'tok_1', 'token');
  assertEq(calls.length, 1, 'fetch calls');
  assertEq(calls[0].url, 'https://dev12345.service-now.com/oauth_token.do', 'token url');
  assertEq(calls[0].opts.method, 'POST', 'method');
  if (!calls[0].opts.body.includes('grant_type=client_credentials')) throw new Error('missing grant_type in body');
  if (!calls[0].opts.body.includes('client_id=cid')) throw new Error('missing client_id in body');
});

await test('getAccessToken caches within the token TTL (no second fetch)', async () => {
  const { getAccessToken } = await freshClient();
  const { fetch, calls } = makeFetch(() => ({ body: { access_token: 'tok_2', expires_in: 1800 } }));
  await getAccessToken(fetch);
  const before = calls.length;
  await getAccessToken(fetch);
  assertEq(calls.length, before, 'no extra fetch on cached call');
});

await test('getAccessToken throws when the token endpoint fails', async () => {
  const { getAccessToken } = await freshClient();
  const { fetch } = makeFetch(() => ({ status: 401, body: {} }));
  let threw = false;
  try { await getAccessToken(fetch); } catch (e) { threw = /HTTP 401/.test(e.message); }
  if (!threw) throw new Error('expected an HTTP 401 error');
});

await test('tableQuery builds an incremental sysparm_query when sinceIso is given', async () => {
  const { tableQuery } = await freshClient();
  const { fetch, calls } = makeFetch((url) => {
    if (url.includes('oauth_token.do')) return { body: { access_token: 'tok_3', expires_in: 1800 } };
    return { body: { result: [{ sys_id: 'a1', short_description: 'x' }] } };
  });
  const rows = await tableQuery(fetch, 'incident', { sinceIso: '2026-07-01T00:00:00.000Z' });
  assertEq(rows.length, 1, 'rows returned');
  const queryCall = calls.find(c => c.url.includes('/api/now/table/incident'));
  if (!queryCall) throw new Error('no table query call recorded');
  if (!queryCall.url.includes(encodeURIComponent('sys_updated_on>2026-07-01T00:00:00.000Z^ORDERBYsys_updated_on'))) {
    throw new Error(`unexpected query string: ${queryCall.url}`);
  }
});

await test('tableQuery omits the since filter on first sync', async () => {
  const { tableQuery } = await freshClient();
  const { fetch, calls } = makeFetch((url) => {
    if (url.includes('oauth_token.do')) return { body: { access_token: 'tok_4', expires_in: 1800 } };
    return { body: { result: [] } };
  });
  await tableQuery(fetch, 'problem', {});
  const queryCall = calls.find(c => c.url.includes('/api/now/table/problem'));
  if (!queryCall.url.includes(encodeURIComponent('ORDERBYsys_updated_on'))) throw new Error(`unexpected query string: ${queryCall.url}`);
  if (queryCall.url.includes('sys_updated_on>')) throw new Error('should not filter by since on first sync');
});

await test('tableWrite POSTs to create (no sysId) and PATCHes to update (sysId given)', async () => {
  const { tableWrite } = await freshClient();
  const { fetch, calls } = makeFetch((url) => {
    if (url.includes('oauth_token.do')) return { body: { access_token: 'tok_5', expires_in: 1800 } };
    return { body: { result: { sys_id: 'a2', short_description: 'created' } } };
  });
  await tableWrite(fetch, 'incident', null, { short_description: 'created' });
  const createCall = calls.find(c => c.url.endsWith('/api/now/table/incident'));
  assertEq(createCall.opts.method, 'POST', 'create method');

  await tableWrite(fetch, 'incident', 'a2', { state: '2' });
  const updateCall = calls.find(c => c.url.endsWith('/api/now/table/incident/a2'));
  assertEq(updateCall.opts.method, 'PATCH', 'update method');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
