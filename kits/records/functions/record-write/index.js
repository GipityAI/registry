// records kit - signed-in member entry to the single write path. Resolves the
// platform identity to an app member (authorization), builds the ACTOR, and
// delegates the actual mutation to the shared write core in _lib.
import { loadObject } from '../_lib/records/registry.js';
import { performWrite } from '../_lib/records/write-core.js';
import { ensureMember, assertCanWrite, actorFor } from './membership.js';

export default async function recordWrite(ctx, { db, guid }) {
  const { action, object: objectName, id, values, rows, expect_updated_at: expectUpdatedAt, source } = ctx.body || {};
  try {
    const object = await loadObject(db, objectName);
    const member = await ensureMember(db, guid, ctx.auth, object);
    assertCanWrite(member);
    // Callers may declare a non-MANUAL provenance for bulk paths (CSV import).
    const actor = actorFor(member, source === 'IMPORT' ? 'IMPORT' : 'MANUAL');
    return await performWrite({ db, guid, object, actor, action, id, values, rows, expectUpdatedAt });
  } catch (err) {
    return { error: err.message };
  }
}
