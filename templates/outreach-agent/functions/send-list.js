// Worker: claim the next batch of approved emails whose send window has arrived
// (scheduled_send_at <= now), flip them to 'sending', and return them ready to send
// from the owner's Gmail: recipient address, subject, and body with a fixed footer that
// carries the AI-drafted disclosure and the opt-out. Claiming up front makes sends
// idempotent. The one-click unsubscribe link is built from settings.app_url (this
// app's public URL, where unsubscribe.html ships); while app_url is unset the footer
// falls back to a reply-to-opt-out line so recipients ALWAYS have a way out.

export default async function sendList(ctx, { db }) {
    const s = (await db.query('SELECT daily_send_cap, app_url FROM settings WHERE id=1')).rows[0] || {};
    const cap = Math.min(Number(s.daily_send_cap) || 10, 25);
    const appUrl = String(s.app_url || '').trim().replace(/\/+$/, '');

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
        'SELECT short_guid, email, unsub_token FROM contacts WHERE short_guid = ANY($1)', [contactGuids])).rows;
    const byGuid = Object.fromEntries(contactRows.map((c) => [c.short_guid, c]));

    const items = rows.map((r) => {
        const c = byGuid[r.contact_guid] || {};
        const optOut = appUrl && c.unsub_token
            ? `Not interested? Unsubscribe here and I will not email you again: ${appUrl}/unsubscribe.html?t=${encodeURIComponent(c.unsub_token)}`
            : `Not interested? Reply "unsubscribe" and I will not email you again.`;
        const footer =
            `\n\n--\n` +
            `This note was drafted by an AI agent running on Gipity.\n` +
            optOut;
        return {
            message_guid: r.short_guid,
            to: c.email,
            subject: r.subject,
            body: `${r.body}${footer}`,
        };
    }).filter((it) => it.to); // never try to send to a contact with no email

    return { items, count: items.length };
}
