// servicenow kit - sn-pull. Invoked on a schedule by workflows/01-poll-servicenow.yaml
// (cron dispatch runs server-side and never goes through the HTTP auth gate;
// `auth: user` in gipity.yaml only closes the direct-HTTP path so a random
// caller can't trigger repeated polls against the customer's instance).
//
// For each table in SERVICENOW_TABLES, pulls rows changed since the last
// synced sn_updated_on for that table and upserts them into sn_records.
// SERVICENOW_TABLES is a secret, not env - there is no CLI/REST path to set a
// project env var (only an agent tool can), so table selection rides the same
// settable channel as the OAuth credentials.
import { tableQuery } from '../_lib/servicenow-client.js';

export default async function snPull(ctx, { db, fetch }) {
  const tablesConfig = await secrets.get('SERVICENOW_TABLES');
  const tables = (tablesConfig || '').split(',').map(t => t.trim()).filter(Boolean);
  if (tables.length === 0) {
    throw new Error('No tables configured. Set SERVICENOW_TABLES via `gipity secrets set` (comma-separated ServiceNow table names).');
  }

  const synced = {};
  for (const table of tables) {
    const { rows } = await db.query('SELECT MAX(sn_updated_on) AS last FROM sn_records WHERE sn_table = $1', [table]);
    // ServiceNow's sys_updated_on has no timezone marker; treated as UTC to
    // match the instance's default Table API response format.
    const sinceIso = rows[0]?.last ? new Date(rows[0].last).toISOString() : null;
    const records = await tableQuery(fetch, table, { sinceIso });

    if (records.length > 0) {
      const values = [];
      const params = [];
      records.forEach((rec, i) => {
        const base = i * 5;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
        params.push(table, rec.sys_id, JSON.stringify(rec), rec.sys_updated_on || null, 'pull');
      });
      await db.query(
        `INSERT INTO sn_records (sn_table, sys_id, data, sn_updated_on, origin)
         VALUES ${values.join(', ')}
         ON CONFLICT (sn_table, sys_id) DO UPDATE SET
           data = EXCLUDED.data, sn_updated_on = EXCLUDED.sn_updated_on, origin = EXCLUDED.origin, synced_at = NOW()`,
        params,
      );
    }
    synced[table] = records.length;
  }
  return { synced };
}
