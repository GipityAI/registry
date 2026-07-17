// servicenow kit - sn-write. Browser/app-code entry point: writes a record
// into ServiceNow, then mirrors the resulting row locally so a follow-up read
// sees it immediately (no wait for the next pull).
import { tableWrite } from '../_lib/servicenow-client.js';

export default async function snWrite(ctx, { db, fetch }) {
  const { table, sysId, fields } = ctx.body || {};
  if (!table || !fields || typeof fields !== 'object') {
    return { error: 'Body must include { table, fields } - and sysId to update an existing record (omit sysId to create).' };
  }

  try {
    const record = await tableWrite(fetch, table, sysId || null, fields);
    await db.query(
      `INSERT INTO sn_records (sn_table, sys_id, data, sn_updated_on, origin)
       VALUES ($1, $2, $3, $4, 'write')
       ON CONFLICT (sn_table, sys_id) DO UPDATE SET
         data = EXCLUDED.data, sn_updated_on = EXCLUDED.sn_updated_on, origin = EXCLUDED.origin, synced_at = NOW()`,
      [table, record.sys_id, JSON.stringify(record), record.sys_updated_on || null],
    );
    return { record };
  } catch (err) {
    return { error: err.message };
  }
}
