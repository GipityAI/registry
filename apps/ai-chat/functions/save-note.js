/** The assistant's save_note tool (it asks the user first): keep a note for the signed-in user. */
export default async function (ctx, { db, guid }) {
  const title = String(ctx.body?.title ?? '').trim().slice(0, 120);
  const body = String(ctx.body?.body ?? '').trim().slice(0, 20_000);
  if (!title || !body) return { error: 'A note needs a title and a body.' };
  const id = guid('note');
  await db.query(
    'INSERT INTO notes (short_guid, user_guid, title, body) VALUES ($1, $2, $3, $4)',
    [id, ctx.auth.userGuid, title, body],
  );
  return { saved: true, id, title };
}
