// contacts kit - authorization layer. Maps a Gipity identity (authentication is
// platform-provided) to an app-level member row + role. Mirrors the records
// kit's membership pattern, standalone over contact_members.
//
// Resolving a member must not WRITE one. A caller whose write is about to be
// rejected - invalid values, read-only role, unknown action - would otherwise
// leave a committed contact_members row behind, and the very first such caller
// would be handed `owner` without ever completing a write. So resolveMember()
// only reads, and claimMember() runs on the write's own transaction, rolling
// back with the write it belonged to.

/**
 * Read the caller's membership. Returns the existing row, or the row they
 * WOULD get, unwritten (`isNew: true`). Throws for a signed-out caller.
 */
export async function resolveMember(db, auth) {
  const userGuid = auth?.userGuid;
  if (!userGuid) throw new Error('Sign in required.');

  const { rows } = await db.query('SELECT * FROM contact_members WHERE user_guid = $1', [userGuid]);
  if (rows.length) return { member: rows[0], isNew: false };

  // Prospective row only - the authoritative role is decided by claimMember()'s
  // INSERT. Both paths agree (first member owner, the rest members), and
  // neither role is read-only, so assertCanWrite's ruling is stable either way.
  const { rows: [{ count }] } = await db.query('SELECT COUNT(*)::int AS count FROM contact_members');
  return {
    member: { id: null, user_guid: userGuid, display_name: auth.displayName || '', role: count === 0 ? 'owner' : 'member' },
    isNew: true,
  };
}

/**
 * Write the membership row. Called on the write's transaction, so it commits
 * only if the write does. First member becomes owner, the rest members. Role is
 * decided inside the INSERT and the unique(user_guid) conflict hands back the
 * existing row, so the same user double-submitting concurrently can't error or
 * duplicate - and re-claiming an already-committed row is a no-op update.
 */
export async function claimMember(tx, guid, auth) {
  const { rows: [member] } = await tx.query(
    `INSERT INTO contact_members (id, user_guid, display_name, role)
     VALUES ($1, $2, $3, (SELECT CASE WHEN COUNT(*) = 0 THEN 'owner' ELSE 'member' END FROM contact_members))
     ON CONFLICT (user_guid) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING *`,
    [guid('mem'), auth.userGuid, auth.displayName || '']
  );
  return member;
}

/**
 * Build the `ensureActor(tx)` the write core calls INSIDE each transaction,
 * after its own validation/lock throw-points. For an existing member it just
 * returns the actor; for a first-time caller it claims the membership on that
 * transaction (idempotent, so per-row transactions may each call it).
 */
export function makeEnsureActor({ member, isNew }, guid, auth, source = 'HUMAN') {
  return async (tx) => actorFor(isNew ? await claimMember(tx, guid, auth) : member, source);
}

export function assertCanWrite(member) {
  if (member.role === 'readonly') {
    throw new Error('Your role is read-only in this app.');
  }
}

// ACTOR provenance value. source HUMAN = a signed-in person in the UI; IMPORT =
// a bulk importer path; AGENT/API = machine writers.
export function actorFor(member, source = 'HUMAN') {
  return { source, memberId: member.id, name: member.display_name || 'Member' };
}
