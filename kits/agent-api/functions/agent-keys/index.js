// agent-api kit - owner-only management of the named API keys machine callers
// use with agent-write. This IS the kit's headline capability ("a named key
// you can revoke if it leaks"), so the kit ships it instead of every app
// hand-rolling one.
//
//   create { action:'create', name, role?: 'writer'|'readonly', source?: 'API'|'AGENT' }
//     -> { key: { id, name, role, source, created_at, secret } }
//     The SECRET is returned exactly once, here. Store it; it is never
//     readable again (list returns a 4-char preview only).
//   list   { action:'list' }    -> { keys: [{ id, name, role, source, created_at, last_used_at, revoked_at, key_preview }] }
//   revoke { action:'revoke', id } -> { revoked: { id, name, revoked_at } }
//
// Gated on the records kit's membership: only a kit_members row with role
// 'owner' may manage keys (the same owner the records UI recognizes).
export default async function agentKeys(ctx, { db, guid, randomToken }) {
  const { action, name, role, source, id } = ctx.body || {};
  try {
    const userGuid = ctx.auth?.userGuid;
    if (!userGuid) throw new Error('Sign in required.');
    const { rows: [member] } = await db.query(
      'SELECT role FROM kit_members WHERE user_guid = $1', [userGuid]
    );
    if (!member || member.role !== 'owner') {
      throw new Error('Only an owner can manage API keys.');
    }

    if (action === 'create') {
      if (!name || typeof name !== 'string') {
        throw new Error("'name' is required - it labels every write this key makes (shown as created_by.name).");
      }
      const keyRole = role === 'readonly' ? 'readonly' : 'writer';
      const keySource = source === 'AGENT' ? 'AGENT' : 'API';
      const secret = randomToken(40); // crypto-random, ~198 bits
      const { rows: [row] } = await db.query(
        `INSERT INTO kit_api_keys (id, name, key, role, source)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, role, source, created_at`,
        [guid('key'), name.trim(), secret, keyRole, keySource]
      );
      return { key: { ...row, secret } };
    }

    if (action === 'list') {
      const { rows } = await db.query(
        `SELECT id, name, role, source, created_at, last_used_at, revoked_at,
                LEFT(key, 4) || '...' AS key_preview
         FROM kit_api_keys ORDER BY created_at DESC`
      );
      return { keys: rows };
    }

    if (action === 'revoke') {
      if (!id) throw new Error("'id' is required for revoke (from list).");
      const { rows: [row] } = await db.query(
        `UPDATE kit_api_keys SET revoked_at = NOW()
         WHERE id = $1 AND revoked_at IS NULL
         RETURNING id, name, revoked_at`,
        [id]
      );
      if (!row) throw new Error('Unknown or already-revoked key id.');
      return { revoked: row };
    }

    throw new Error(`Unknown action '${action}'. Use create | list | revoke.`);
  } catch (err) {
    return { error: err.message };
  }
}
