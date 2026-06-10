// Authorization layer: maps a Gipity identity (authentication, platform-provided)
// to an app-level member row + role. Helper: db passed in.

export async function ensureMember(db, guid, auth, object) {
  const userGuid = auth?.userGuid;
  if (!userGuid) throw new Error('Sign in required.');

  const { rows } = await db.query('SELECT * FROM kit_members WHERE user_guid = $1', [userGuid]);
  if (rows.length) return rows[0];

  if (object.membership !== 'open') {
    throw new Error('This app is invite-only. Ask an owner to invite you.');
  }

  // Open membership: first member becomes owner, the rest members. Role is decided
  // inside the INSERT and the unique(user_guid) conflict hands back the existing row,
  // so the same user double-submitting concurrently can't error or duplicate.
  const { rows: [member] } = await db.query(
    `INSERT INTO kit_members (id, user_guid, display_name, role)
     VALUES ($1, $2, $3, (SELECT CASE WHEN COUNT(*) = 0 THEN 'owner' ELSE 'member' END FROM kit_members))
     ON CONFLICT (user_guid) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING *`,
    [guid('mem'), userGuid, auth.displayName || '']
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
