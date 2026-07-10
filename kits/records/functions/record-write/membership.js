// Authorization layer: maps a Gipity identity (authentication, platform-provided)
// to an app-level member row + role. Helper: db passed in.
//
// Resolving a member must not WRITE one. A caller whose write is about to be
// rejected - invalid values, read-only role, missing record - would otherwise
// leave a committed kit_members row behind, and on an `open` app the very first
// such caller is handed `owner`. A validation smoke-test would silently take
// ownership. So resolve() only reads, and claim() runs inside the write's own
// transaction (see write-core's ensureActor), which rolls the claim back with
// the write it belonged to.

/**
 * Read the caller's membership. Returns the existing row, or - on an `open`
 * app - the row they WOULD get, unwritten (`isNew: true`). Throws for a signed
 * -out caller or a non-member of an invite-only app.
 */
export async function resolveMember(db, auth, object) {
  const userGuid = auth?.userGuid;
  if (!userGuid) throw new Error('Sign in required.');

  const { rows } = await db.query('SELECT * FROM kit_members WHERE user_guid = $1', [userGuid]);
  if (rows.length) return { member: rows[0], isNew: false };

  if (object.membership !== 'open') {
    throw new Error('This app is invite-only. Ask an owner to invite you.');
  }

  // Prospective row only - the authoritative role is decided by claim()'s INSERT.
  // This copy exists so assertCanWrite can rule on the role before we commit to
  // anything; both paths agree (first member owner, the rest members), and
  // neither role is read-only, so the ruling is stable either way.
  const { rows: [{ count }] } = await db.query('SELECT COUNT(*)::int AS count FROM kit_members');
  return {
    member: { id: null, user_guid: userGuid, display_name: auth.displayName || '', role: count === 0 ? 'owner' : 'member' },
    isNew: true,
  };
}

/**
 * Write the membership row. Called on the write's transaction, so it commits
 * only if the write does. Open membership: first member becomes owner, the rest
 * members. Role is decided inside the INSERT and the unique(user_guid) conflict
 * hands back the existing row, so the same user double-submitting concurrently
 * can't error or duplicate.
 */
export async function claimMember(tx, guid, auth) {
  const { rows: [member] } = await tx.query(
    `INSERT INTO kit_members (id, user_guid, display_name, role)
     VALUES ($1, $2, $3, (SELECT CASE WHEN COUNT(*) = 0 THEN 'owner' ELSE 'member' END FROM kit_members))
     ON CONFLICT (user_guid) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING *`,
    [guid('mem'), auth.userGuid, auth.displayName || '']
  );
  return member;
}

export function assertCanWrite(member) {
  if (member.role === 'readonly') {
    throw new Error('Your role is read-only in this app.');
  }
}

// ACTOR provenance value (PLAN.md Bet 3). source MANUAL = a signed-in human in the UI.
export function actorFor(member, source = 'MANUAL') {
  return { source, memberId: member.id, name: member.display_name || 'Member' };
}
