// contacts kit - authorization layer. Maps a Gipity identity (authentication is
// platform-provided) to an app-level member row + role. Mirrors the records
// kit's membership pattern, standalone over contact_members.

export async function ensureMember(db, guid, auth) {
  const userGuid = auth?.userGuid;
  if (!userGuid) throw new Error('Sign in required.');

  const { rows } = await db.query('SELECT * FROM contact_members WHERE user_guid = $1', [userGuid]);
  if (rows.length) return rows[0];

  // First member becomes owner, the rest members. Role is decided inside the
  // INSERT and the unique(user_guid) conflict hands back the existing row, so a
  // user double-submitting concurrently can't error or duplicate.
  const { rows: [member] } = await db.query(
    `INSERT INTO contact_members (id, user_guid, display_name, role)
     VALUES ($1, $2, $3, (SELECT CASE WHEN COUNT(*) = 0 THEN 'owner' ELSE 'member' END FROM contact_members))
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

// ACTOR provenance value. source HUMAN = a signed-in person in the UI; IMPORT =
// a bulk importer path; AGENT/API = machine writers.
export function actorFor(member, source = 'HUMAN') {
  return { source, memberId: member.id, name: member.display_name || 'Member' };
}
