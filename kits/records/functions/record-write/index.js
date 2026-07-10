// records kit - signed-in member entry to the single write path. Resolves the
// platform identity to an app member (authorization), builds the ACTOR, and
// delegates the actual mutation to the shared write core in _lib.
import { loadObject } from '../_lib/records/registry.js';
import { performWrite } from '../_lib/records/write-core.js';
import { resolveMember, claimMember, assertCanWrite, actorFor } from './membership.js';

export default async function recordWrite(ctx, { db, guid }) {
  const { action, object: objectName, id, values, rows, expect_updated_at: expectUpdatedAt, source } = ctx.body || {};
  try {
    const object = await loadObject(db, objectName);
    const { member, isNew } = await resolveMember(db, ctx.auth, object);
    assertCanWrite(member);
    // Callers may declare a non-MANUAL provenance for bulk paths (CSV import).
    const provenance = source === 'IMPORT' ? 'IMPORT' : 'MANUAL';
    // A first-time member's row is written on the write's OWN transaction, not
    // here: a create that fails validation must not leave them holding `owner`.
    // An existing member costs no extra query.
    const ensureActor = async (tx) =>
      actorFor(isNew ? await claimMember(tx, guid, ctx.auth) : member, provenance);
    return await performWrite({ db, guid, object, ensureActor, action, id, values, rows, expectUpdatedAt });
  } catch (err) {
    return { error: err.message };
  }
}
