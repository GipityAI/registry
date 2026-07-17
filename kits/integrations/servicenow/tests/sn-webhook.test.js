/**
 * Tests for functions/sn-webhook/index.js.
 * Run: node kits/integrations/servicenow/tests/sn-webhook.test.js
 *
 * `secrets` is an ambient global inside the real function sandbox (never
 * imported) - this harness stands one up on globalThis before importing the
 * module, same pattern as servicenow-client.test.js.
 */
globalThis.secrets = {
  value: 'shh-its-a-secret',
  async get(name) { return name === 'SERVICENOW_WEBHOOK_SECRET' ? this.value : null; },
};

const { default: snWebhook } = await import('../functions/sn-webhook/index.js');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}
const assertEq = (actual, expected, msg) => {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

/** Stub db.query, records every call. */
function makeDb() {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
  return { db, calls };
}

const VALID_RECORD = { sys_table: 'incident', sys_id: 'a1', number: 'INC0000060', sys_updated_on: '2026-07-17 03:06:24' };

console.log('sn-webhook');

await test('throws when SERVICENOW_WEBHOOK_SECRET is not configured', async () => {
  globalThis.secrets.value = null;
  const { db } = makeDb();
  let threw = false;
  try { await snWebhook({ body: { secret: 'x', record: VALID_RECORD } }, { db }); } catch { threw = true; }
  globalThis.secrets.value = 'shh-its-a-secret';
  if (!threw) throw new Error('expected a throw');
});

await test('throws when the secret does not match', async () => {
  const { db } = makeDb();
  let threw = false;
  try { await snWebhook({ body: { secret: 'wrong', record: VALID_RECORD } }, { db }); } catch { threw = true; }
  if (!threw) throw new Error('expected a throw');
});

await test('throws when record is missing sys_table/sys_id', async () => {
  const { db } = makeDb();
  let threw = false;
  try { await snWebhook({ body: { secret: 'shh-its-a-secret', record: { number: 'INC1' } } }, { db }); } catch { threw = true; }
  if (!threw) throw new Error('expected a throw');
});

await test('throws when body has no record at all', async () => {
  const { db } = makeDb();
  let threw = false;
  try { await snWebhook({ body: { secret: 'shh-its-a-secret' } }, { db }); } catch { threw = true; }
  if (!threw) throw new Error('expected a throw');
});

await test('upserts sn_records with origin=webhook on a valid call', async () => {
  const { db, calls } = makeDb();
  const result = await snWebhook({ body: { secret: 'shh-its-a-secret', record: VALID_RECORD } }, { db });
  assertEq(result.ok, true, 'result.ok');
  assertEq(calls.length, 1, 'db.query calls');
  if (!calls[0].sql.includes("'webhook'")) throw new Error('expected origin=webhook in the upsert SQL');
  assertEq(calls[0].params[0], 'incident', 'sn_table param');
  assertEq(calls[0].params[1], 'a1', 'sys_id param');
  assertEq(JSON.parse(calls[0].params[2]).number, 'INC0000060', 'stored data payload');
  assertEq(calls[0].params[3], '2026-07-17 03:06:24', 'sn_updated_on param');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
