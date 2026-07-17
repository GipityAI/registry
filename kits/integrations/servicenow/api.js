// servicenow kit - client API. Thin wrapper over the sn-* functions. Kit rule:
// no app-specific imports here (sealed kit).
async function call(fn, body) {
  const data = await Gipity.fn(fn, body);
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Manually trigger a pull cycle (the same work the 5-minute cron runs). */
export function pullNow() {
  return call('sn-pull', {});
}

/** Read mirrored rows for a table via your own app code's db access -
 *  sn_records is a plain table (sn_table, sys_id, data jsonb, sn_updated_on,
 *  origin, synced_at). This kit ships no generic read function; query it
 *  directly from your own functions/records phase, filtered by sn_table. */

/** Create (omit sysId) or update (pass sysId) a ServiceNow record, then mirror
 *  the result locally. `fields` is the ServiceNow field/value payload. */
export function writeRecord(table, sysId, fields) {
  return call('sn-write', { table, sysId, fields });
}
