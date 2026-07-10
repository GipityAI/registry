/**
 * Tests for the membership claim in functions/record-write/.
 * Run: node kits/records/tests/membership-claim.test.js
 *
 * The invariant: resolving a caller's membership must never WRITE one. Only a
 * write that actually commits may claim a kit_members row. On an `open` app the
 * first claimant is handed `owner`, so a rejected write that claimed anyway
 * would let a throwaway smoke-test (`record-write {"action":"create",
 * "object":"game","values":{}}`) silently take ownership of a live app. That is
 * cli#131, and it is what these tests pin down.
 */
import recordWrite from '../functions/record-write/index.js';

const OBJECT = {
  name: 'game', label: 'Game', table_name: 'games', title_field: 'title',
  membership: 'open',
  fields: [{ name: 'title', type: 'text', required: true }],
};

/** Stub db. `tx` rolls back the members table on throw, like a real transaction. */
function makeDb(object = OBJECT) {
  const members = [];
  const handle = (sql, params) => {
    if (/FROM kit_objects/.test(sql)) return { rows: [object] };
    if (/FROM kit_fields/.test(sql)) return { rows: object.fields.map(f => ({ ...f, object_name: object.name })) };
    if (/SELECT \* FROM kit_members/.test(sql)) return { rows: [] };
    if (/COUNT\(\*\)::int/.test(sql)) return { rows: [{ count: members.length }] };
    if (/INSERT INTO kit_members/.test(sql)) {
      const row = { id: params[0], user_guid: params[1], display_name: params[2], role: members.length === 0 ? 'owner' : 'member' };
      members.push(row);
      return { rows: [row] };
    }
    if (/INSERT INTO games/.test(sql)) return { rows: [{ id: 'gam_1', title: 'x' }] };
    return { rows: [{}] };
  };
  const db = {
    query: async (sql, params) => handle(sql, params),
    tx: async (fn) => {
      const snapshot = members.length;
      try {
        return await fn({ query: async (sql, params) => handle(sql, params) });
      } catch (err) {
        members.length = snapshot; // ROLLBACK
        throw err;
      }
    },
  };
  return { db, members };
}

const guid = (prefix) => `${prefix}_test`;
const auth = { userGuid: 'usr_1', displayName: 'Steve' };
const call = (body, db) => recordWrite({ auth, body }, { db, guid });

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}
const assertEq = (actual, expected, msg) => {
  if (actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`);
};

console.log('record-write membership claim');

await test('a create that fails validation claims no membership', async () => {
  const { db, members } = makeDb();
  const res = await call({ action: 'create', object: 'game', values: {} }, db);
  if (!/'title' is required/.test(res.error || '')) throw new Error(`expected a validation error, got ${JSON.stringify(res)}`);
  assertEq(members.length, 0, 'kit_members rows written');
});

await test('a create that succeeds claims membership, first writer is owner', async () => {
  const { db, members } = makeDb();
  const res = await call({ action: 'create', object: 'game', values: { title: 'Catan' } }, db);
  if (!res.record) throw new Error(`expected a record, got ${JSON.stringify(res)}`);
  assertEq(members.length, 1, 'kit_members rows written');
  assertEq(members[0].role, 'owner', 'first member role');
});

await test('an unknown action claims no membership', async () => {
  const { db, members } = makeDb();
  const res = await call({ action: 'frobnicate', object: 'game' }, db);
  if (!/Unknown action/.test(res.error || '')) throw new Error(`expected an unknown-action error, got ${JSON.stringify(res)}`);
  assertEq(members.length, 0, 'kit_members rows written');
});

await test('an invite-only app claims no membership for a non-member', async () => {
  const { db, members } = makeDb({ ...OBJECT, membership: 'invite' });
  const res = await call({ action: 'create', object: 'game', values: { title: 'Catan' } }, db);
  if (!/invite-only/.test(res.error || '')) throw new Error(`expected an invite-only error, got ${JSON.stringify(res)}`);
  assertEq(members.length, 0, 'kit_members rows written');
});

await test('create_many with every row invalid claims no membership', async () => {
  const { db, members } = makeDb();
  const res = await call({ action: 'create_many', object: 'game', rows: [{}, {}] }, db);
  assertEq(res.created, 0, 'rows created');
  assertEq(members.length, 0, 'kit_members rows written');
});

await test('create_many with one valid row claims membership exactly once', async () => {
  const { db, members } = makeDb();
  const res = await call({ action: 'create_many', object: 'game', rows: [{}, { title: 'Azul' }] }, db);
  assertEq(res.created, 1, 'rows created');
  assertEq(members.length, 1, 'kit_members rows written');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
