// agent-api kit - API-key entry to the single write path (PLAN.md Bet 4: the
// agent is a first-class client). A named key maps to an AGENT/API actor, so
// every machine write is attributed on the same event spine as human writes.
// The mutation itself is the shared write core - one write path, two doors.
import { loadObject } from '../_lib/records/registry.js';
import { performWrite } from '../_lib/records/write-core.js';

export default async function agentWrite(ctx, { db, guid }) {
  const { api_key: apiKey, action, object: objectName, id, values, expect_updated_at: expectUpdatedAt } = ctx.body || {};
  try {
    if (!apiKey) {
      throw new Error("'api_key' is required. Pass your named API key in the request body.");
    }
    const { rows: [key] } = await db.query(
      'SELECT * FROM kit_api_keys WHERE key = $1 AND revoked_at IS NULL', [apiKey]
    );
    if (!key) throw new Error('Unknown or revoked API key.');
    if (key.role === 'readonly') throw new Error(`API key '${key.name}' is read-only.`);

    const object = await loadObject(db, objectName);
    const actor = { source: key.source || 'API', memberId: key.id, name: key.name };
    const result = await performWrite({ db, guid, object, actor, action, id, values, expectUpdatedAt });
    // Bookkeeping only - a failure here must never mislabel a committed write
    // as an error (the caller would retry and duplicate it).
    await db.query('UPDATE kit_api_keys SET last_used_at = NOW() WHERE id = $1', [key.id]).catch(() => {});
    return result;
  } catch (err) {
    return { error: err.message };
  }
}
