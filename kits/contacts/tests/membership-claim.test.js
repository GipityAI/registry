/**
 * Tests for the membership claim in functions/contact-write/.
 * Run: node kits/contacts/tests/membership-claim.test.js
 *
 * The invariant (ported from the records kit, registry#25): resolving a
 * caller's membership must never WRITE one. Only a write that actually commits
 * may claim a contact_members row. The first claimant is handed `owner`, so a
 * rejected write that claimed anyway would let a throwaway smoke-test
 * (`contact-write {"action":"update","id":"nope","values":{}}`) silently take
 * ownership of a live app.
 */
import contactWrite from '../functions/contact-write/index.js';

/** Stub db. `tx` rolls back contact_members on throw, like a real transaction. */
function makeDb() {
  const members = [];
  const handle = (sql, params) => {
    if (/SELECT \* FROM contact_members/.test(sql)) return { rows: [] };
    if (/COUNT\(\*\)::int AS count FROM contact_members/.test(sql)) return { rows: [{ count: members.length }] };
    if (/INSERT INTO contact_members/.test(sql)) {
      const row = { id: params[0], user_guid: params[1], display_name: params[2], role: members.length === 0 ? 'owner' : 'member' };
      members.push(row);
      return { rows: [row] };
    }
    if (/FROM contacts WHERE id = \$1 AND deleted_at IS NULL FOR UPDATE/.test(sql)) {
      // Only the known contact exists.
      return params[0] === 'con_1' ? { rows: [{ id: 'con_1', display_name: 'Ada', score: null }] } : { rows: [] };
    }
    if (/INSERT INTO tags/.test(sql)) return { rows: [{ id: 'tag_1', label: params[1], color: null }] };
    if (/UPDATE contacts SET/.test(sql)) return { rows: [{ id: 'con_1', display_name: params[0], score: null }] };
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
const call = (body, db) => contactWrite({ auth, body }, { db, guid });

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}
const assertEq = (actual, expected, msg) => {
  if (actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`);
};

console.log('contact-write membership claim');

await test('an unknown action claims no membership', async () => {
  const { db, members } = makeDb();
  const res = await call({ action: 'summon' }, db);
  if (!/Unknown action/.test(res.error || '')) throw new Error(`expected an unknown-action error, got ${JSON.stringify(res)}`);
  assertEq(members.length, 0, 'contact_members rows written');
});

await test('an update with nothing to update claims no membership', async () => {
  const { db, members } = makeDb();
  const res = await call({ action: 'update', id: 'con_1', values: {} }, db);
  if (!/Nothing to update/.test(res.error || '')) throw new Error(`expected a validation error, got ${JSON.stringify(res)}`);
  assertEq(members.length, 0, 'contact_members rows written');
});

await test('an update on a missing contact rolls the claim back with the tx', async () => {
  const { db, members } = makeDb();
  const res = await call({ action: 'update', id: 'con_missing', values: { display_name: 'X' } }, db);
  if (!/No contact/.test(res.error || '')) throw new Error(`expected a missing-contact error, got ${JSON.stringify(res)}`);
  assertEq(members.length, 0, 'contact_members rows written');
});

await test('a write that succeeds claims membership, first writer is owner', async () => {
  const { db, members } = makeDb();
  const res = await call({ action: 'tag_create', label: 'VIP' }, db);
  if (!res.tag) throw new Error(`expected a tag, got ${JSON.stringify(res)}`);
  assertEq(members.length, 1, 'contact_members rows written');
  assertEq(members[0].role, 'owner', 'first member role');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
