/**
 * The assistant's query_data tool: run one read-only SQL query over the shop
 * tables and return the rows. Safe to hand to a model because:
 *   - gipity.yaml grants this function only the shop tables (not chats or
 *     notes), and the platform refuses any other table;
 *   - the query runs in a READ ONLY transaction, so it can't change anything;
 *   - the platform's per-call limits (time, rows) still apply.
 */

const MAX_ROWS = 200;

export default async function (ctx, { db }) {
  const sql = String(ctx.body?.sql ?? '').trim().replace(/;\s*$/, '');
  if (!sql) return { error: 'Pass sql: one SELECT statement.' };
  if (!/^(select|with)\b/i.test(sql)) return { error: 'Only SELECT queries are allowed.' };
  if (sql.includes(';')) return { error: 'Send one statement at a time.' };

  try {
    const { rows } = await db.tx(async (tx) => {
      await tx.query('SET TRANSACTION READ ONLY');
      return tx.query(sql);
    });
    return {
      rowCount: rows.length,
      columns: rows.length ? Object.keys(rows[0]) : [],
      rows: rows.slice(0, MAX_ROWS),
      ...(rows.length > MAX_ROWS && { note: `Showing the first ${MAX_ROWS} of ${rows.length} rows. Aggregate or add LIMIT for the rest.` }),
    };
  } catch (err) {
    // The model reads this and fixes its query.
    return { error: `The query failed: ${err.message}` };
  }
}
