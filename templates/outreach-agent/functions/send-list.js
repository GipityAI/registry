// Worker: claim the next batch of approved emails whose send window has arrived
// (scheduled_send_at <= now), flip them to 'sending', and return them with recipient
// addresses for the workflow's notify step. Claiming up front makes sends idempotent.
export default async function sendList(ctx, { db }) {
    const s = (await db.query('SELECT daily_send_cap FROM settings WHERE id=1')).rows[0] || {};
    const cap = Math.min(Number(s.daily_send_cap) || 10, 25);

    const { rows } = await db.query(
        `UPDATE messages SET status='sending'
         WHERE short_guid IN (
             SELECT short_guid FROM messages
             WHERE status='approved'
               AND (scheduled_send_at IS NULL OR scheduled_send_at <= NOW())
             ORDER BY scheduled_send_at ASC NULLS FIRST, created_at ASC
             LIMIT $1
         )
         RETURNING short_guid, contact_guid, subject, body`, [cap]);
    if (!rows.length) return { items: [], count: 0 };

    const contactGuids = rows.map((r) => r.contact_guid);
    const contactRows = (await db.query(
        'SELECT short_guid, email FROM contacts WHERE short_guid = ANY($1)', [contactGuids])).rows;
    const emailByGuid = Object.fromEntries(contactRows.map((c) => [c.short_guid, c.email]));

    const items = rows.map((r) => ({
        message_guid: r.short_guid,
        to: emailByGuid[r.contact_guid],
        subject: r.subject,
        body: r.body,
    }));
    return { items, count: items.length };
}
