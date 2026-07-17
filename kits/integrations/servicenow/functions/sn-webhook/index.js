// servicenow kit - sn-webhook. Public receiver for real-time pushes from the
// ServiceNow-side Business Rule (via the GipitySync Script Include, set up by
// scripts/connect-realtime.mjs).
//
// The shared secret travels inside the JSON body ({ secret, record }), NOT a
// header - the platform's function runtime only forwards a small allowlist of
// headers to function code (content-type, accept, user-agent, x-request-id,
// origin, referer, x-forwarded-for, x-real-ip); a custom x-gipity-secret
// header would be silently stripped before ctx.headers ever saw it.
//
// Throws (rather than returning { error }) on auth/shape failures so the
// caller sees a non-2xx status - ServiceNow's Script Include logs those via
// gs.error, which is the whole point of failing loudly here: a silently
// swallowed 200 on a bad secret would look like success on both sides while
// nothing actually synced.
export default async function snWebhook(ctx, { db }) {
  const { secret, record } = ctx.body || {};
  const expected = await secrets.get('SERVICENOW_WEBHOOK_SECRET');
  if (!expected) throw new Error('SERVICENOW_WEBHOOK_SECRET is not configured on this app.');
  if (secret !== expected) throw new Error('Invalid webhook secret.');
  if (!record || !record.sys_table || !record.sys_id) {
    throw new Error('Payload must be { secret, record: { sys_table, sys_id, ... } }.');
  }

  await db.query(
    `INSERT INTO sn_records (sn_table, sys_id, data, sn_updated_on, origin)
     VALUES ($1, $2, $3, $4, 'webhook')
     ON CONFLICT (sn_table, sys_id) DO UPDATE SET
       data = EXCLUDED.data, sn_updated_on = EXCLUDED.sn_updated_on, origin = EXCLUDED.origin, synced_at = NOW()`,
    [record.sys_table, record.sys_id, JSON.stringify(record), record.sys_updated_on || null],
  );
  return { ok: true };
}
