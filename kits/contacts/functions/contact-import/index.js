// contacts kit - generic import door. Takes already-parsed rows for one source
// (linkedin | gmail | manual | paste) and drives them through the resolution
// engine: dedupe, keep-all attribute folding, job-change detection, and the
// tier-3 merge-review queue. Both the LinkedIn CSV path (client parses, posts
// rows here) and the Gmail harvest funnel through this single endpoint.
import { resolveMember, makeEnsureActor, assertCanWrite } from '../_lib/contacts/members.js';
import { importRows } from '../_lib/contacts/write-core.js';

const SOURCES = new Set(['linkedin', 'gmail', 'manual', 'paste']);

export default async function contactImport(ctx, { db, guid }) {
  const { source, rows } = ctx.body || {};
  try {
    if (!SOURCES.has(source)) {
      return { error: `Unknown source '${source}'. Valid: ${[...SOURCES].join(', ')}.` };
    }
    // Read-only resolve; the membership row is claimed inside each row's own
    // transaction, so a batch whose every row fails claims nothing.
    const resolved = await resolveMember(db, ctx.auth);
    assertCanWrite(resolved.member);
    const ensureActor = makeEnsureActor(resolved, guid, ctx.auth, 'IMPORT');
    return await importRows({ db, guid, ensureActor, source, rows });
  } catch (err) {
    return { error: err.message };
  }
}
