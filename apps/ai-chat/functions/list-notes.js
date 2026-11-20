/** The assistant's list_notes tool: the signed-in user's saved notes, newest first. */
export default async function (ctx, { db }) {
  const { rows } = await db.query(
    `SELECT short_guid AS id, title, body, created_at AS "createdAt" FROM notes
     WHERE user_guid = $1 ORDER BY created_at DESC LIMIT 50`,
    [ctx.auth.userGuid],
  );
  return { notes: rows };
}
