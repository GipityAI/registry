/**
 * Tests for scripts/lib/servicenow-setup.js (the connect.mjs setup script's
 * pure logic). Run: node kits/integrations/servicenow/tests/servicenow-setup.test.js
 */
import {
  basicAuthHeader, testAuth, getUserSysId, ensureGrantTypeProperty,
  createOrUpdateOAuthEntity, verifyClientCredentials,
} from '../scripts/lib/servicenow-setup.js';

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

console.log('servicenow-setup');

await test('basicAuthHeader base64-encodes user:pass', () => {
  assertEq(basicAuthHeader('a', 'b'), 'Basic ' + Buffer.from('a:b').toString('base64'));
});

await test('testAuth gives a specific hint on 401 (the admin-account gotcha)', async () => {
  const { fetch } = makeFetch(() => ({ status: 401 }));
  let threw = '';
  try { await testAuth(fetch, 'https://x', 'admin', 'pw'); } catch (e) { threw = e.message; }
  if (!/admin/.test(threw) || !/dedicated service account/.test(threw)) throw new Error(`missing hint: ${threw}`);
});

await test('testAuth passes through on 200', async () => {
  const { fetch } = makeFetch(() => ({ status: 200, body: { result: [] } }));
  await testAuth(fetch, 'https://x', 'api_user', 'pw'); // does not throw
});

await test('getUserSysId returns sys_id for an active user', async () => {
  const { fetch } = makeFetch(() => ({ body: { result: [{ sys_id: 'u1', active: 'true' }] } }));
  const id = await getUserSysId(fetch, 'https://x', 'auth', 'api_user');
  assertEq(id, 'u1', 'sys_id');
});

await test('getUserSysId throws when the user does not exist', async () => {
  const { fetch } = makeFetch(() => ({ body: { result: [] } }));
  let threw = false;
  try { await getUserSysId(fetch, 'https://x', 'auth', 'ghost'); } catch { threw = true; }
  if (!threw) throw new Error('expected a not-found error');
});

await test('getUserSysId throws when the user is inactive', async () => {
  const { fetch } = makeFetch(() => ({ body: { result: [{ sys_id: 'u1', active: 'false' }] } }));
  let threw = false;
  try { await getUserSysId(fetch, 'https://x', 'auth', 'api_user'); } catch { threw = true; }
  if (!threw) throw new Error('expected an inactive-user error');
});

await test('ensureGrantTypeProperty is a no-op when already true', async () => {
  const { fetch, calls } = makeFetch(() => ({ body: { result: [{ sys_id: 'p1', value: 'true' }] } }));
  const result = await ensureGrantTypeProperty(fetch, 'https://x', 'auth');
  assertEq(result, 'already-enabled', 'result');
  assertEq(calls.length, 1, 'fetch calls'); // only the GET, no write
});

await test('ensureGrantTypeProperty PATCHes an existing false property to true', async () => {
  let getCalled = false;
  const { fetch, calls } = makeFetch((url, opts) => {
    if (!getCalled) { getCalled = true; return { body: { result: [{ sys_id: 'p1', value: 'false' }] } }; }
    return { body: {} };
  });
  const result = await ensureGrantTypeProperty(fetch, 'https://x', 'auth');
  assertEq(result, 'enabled-existing', 'result');
  assertEq(calls[1].opts.method, 'PATCH', 'second call method');
});

await test('ensureGrantTypeProperty creates the property when absent', async () => {
  let getCalled = false;
  const { fetch, calls } = makeFetch((url, opts) => {
    if (!getCalled) { getCalled = true; return { body: { result: [] } }; }
    return { body: {} };
  });
  const result = await ensureGrantTypeProperty(fetch, 'https://x', 'auth');
  assertEq(result, 'created', 'result');
  assertEq(calls[1].opts.method, 'POST', 'second call method');
  if (!calls[1].opts.body.includes('glide.oauth.inbound.client.credential.grant_type.enabled')) {
    throw new Error('create payload missing the property name');
  }
});

await test('createOrUpdateOAuthEntity creates entity + profile when none exists', async () => {
  const { fetch, calls } = makeFetch((url) => {
    if (url.includes('sysparm_query=name=')) return { body: { result: [] } }; // findExistingEntity: none
    if (url.endsWith('/oauth_entity')) return { body: { result: { sys_id: 'e1' } } };
    if (url.endsWith('/oauth_entity_profile')) return { body: { result: { sys_id: 'p1' } } };
    return { body: {} };
  });
  const result = await createOrUpdateOAuthEntity(fetch, 'https://x', 'auth', {
    name: 'Gipity Integration', clientId: 'cid', clientSecret: 'sec', userSysId: 'u1',
  });
  assertEq(result.reused, false, 'reused');
  const profileCall = calls.find(c => c.url.endsWith('/oauth_entity_profile'));
  if (!profileCall) throw new Error('entity profile was not created');
  if (!profileCall.opts.body.includes('"grant_type":"client_credentials"')) throw new Error('profile missing grant_type');
});

await test('createOrUpdateOAuthEntity PATCHes (rotates) an existing entity, no new profile', async () => {
  const { fetch, calls } = makeFetch((url) => {
    if (url.includes('sysparm_query=name=')) return { body: { result: [{ sys_id: 'e1' }] } }; // found existing
    return { body: { result: { sys_id: 'e1' } } };
  });
  const result = await createOrUpdateOAuthEntity(fetch, 'https://x', 'auth', {
    name: 'Gipity Integration', clientId: 'cid2', clientSecret: 'sec2', userSysId: 'u1',
  });
  assertEq(result.reused, true, 'reused');
  const patchCall = calls.find(c => c.url.endsWith('/oauth_entity/e1'));
  if (!patchCall || patchCall.opts.method !== 'PATCH') throw new Error('expected a PATCH to the existing entity');
  const profileCall = calls.find(c => c.url.endsWith('/oauth_entity_profile'));
  if (profileCall) throw new Error('should not create a new profile when reusing an entity');
});

await test('verifyClientCredentials succeeds when token exchange + table read both work', async () => {
  const { fetch } = makeFetch((url) => {
    if (url.includes('oauth_token.do')) return { body: { access_token: 'tok' } };
    return { body: { result: [] } };
  });
  await verifyClientCredentials(fetch, 'https://x', 'cid', 'sec'); // does not throw
});

await test('verifyClientCredentials gives a propagation-delay hint on token failure', async () => {
  const { fetch } = makeFetch(() => ({ status: 401 }));
  let threw = '';
  try { await verifyClientCredentials(fetch, 'https://x', 'cid', 'sec'); } catch (e) { threw = e.message; }
  if (!/propagate/.test(threw)) throw new Error(`missing propagation hint: ${threw}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
