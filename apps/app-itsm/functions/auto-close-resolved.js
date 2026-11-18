// auto-close-resolved.js - Close incidents that have sat in "resolved" too long
// Run daily by the "Auto-Close Resolved Incidents" cron workflow (auth: member).
// The period comes from the auto_close_days app setting (default 7).

export default async function autoCloseResolved(ctx, { db }) {
    const { rows: [row] } = await db.query(`SELECT value FROM app_settings WHERE key = 'auto_close_days'`);
    const days = Number.parseInt(row?.value ?? 7, 10) || 7;

    const { rows: closed } = await db.query(
        `UPDATE incidents SET state = 'closed', closed_at = NOW(), updated_at = NOW()
         WHERE state = 'resolved' AND resolved_at < NOW() - make_interval(days => $1::int)
         RETURNING id, number`,
        [days]
    );
    if (closed.length === 0) return { days, closed: 0 };

    const ids = closed.map((r) => r.id);
    await db.query(
        `INSERT INTO comments (target_table, target_id, comment_type, body, author_name, is_ai_generated)
         SELECT 'incidents', id, 'work_note', $1, 'Workflow: Auto-Close', true
         FROM unnest($2::int[]) AS id`,
        [`Automatically closed after ${days} days in resolved state.`, ids]
    );
    await db.query(
        `UPDATE sla_tasks SET state = 'completed', end_time = NOW(), updated_at = NOW()
         WHERE incident_id = ANY($1::int[]) AND state = 'in_progress'`,
        [ids]
    );

    return { days, closed: closed.length, numbers: closed.map((r) => r.number) };
}
