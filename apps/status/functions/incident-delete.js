// Remove an incident posted by mistake, with its updates (owner only:
// `auth: member`). Body: { incident: '<id>' }. To close a real incident,
// post a `resolved` update with incident-post instead, so its history stays.
export default async function (ctx, { db }) {
  const id = ctx.body?.incident;
  if (typeof id !== 'string' || !id) return { error: 'incident must be the id of an existing incident' };
  const { rowCount } = await db.query('DELETE FROM status_incidents WHERE short_guid = $1', [id]);
  if (!rowCount) return { error: 'incident not found' };
  return { ok: true, deleted: id };
}
