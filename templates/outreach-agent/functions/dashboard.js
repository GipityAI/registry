// Aggregate stats for the funnel board. The board's five columns map to:
//   To draft         - sendable contacts that are due and have no pending draft
//   Pending approval - messages awaiting your review (pending_approval | revising)
//   Scheduled        - approved messages waiting for their send window
//   Sent             - messages already delivered
//   Replied/Feedback - contacts who wrote back (the sequence paused for them)
export default async function dashboard(ctx, { db }) {
    const one = async (sql) => (await db.query(sql)).rows[0].n;

    const totalContacts = await one('SELECT COUNT(*)::int AS n FROM contacts');
    const candidates = await one("SELECT COUNT(*)::int AS n FROM contacts WHERE status='to_qualify'");
    const toDraft = await one(
        `SELECT COUNT(*)::int AS n FROM contacts c
         WHERE c.status IN ('new','in_sequence')
           AND c.next_contact_at IS NOT NULL AND c.next_contact_at <= NOW()
           AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.contact_guid=c.short_guid
                           AND m.status IN ('pending_approval','revising','approved','sending'))`);
    const pending = await one("SELECT COUNT(*)::int AS n FROM messages WHERE status IN ('pending_approval','revising')");
    const scheduled = await one("SELECT COUNT(*)::int AS n FROM messages WHERE status='approved'");
    const sent7 = await one("SELECT COUNT(*)::int AS n FROM messages WHERE status='sent' AND sent_at > NOW() - INTERVAL '7 days'");
    const replied = await one("SELECT COUNT(*)::int AS n FROM contacts WHERE status='replied'");

    const statusCounts = (await db.query(
        'SELECT status, COUNT(*)::int AS n FROM contacts GROUP BY status')).rows;

    const recent = (await db.query(
        `SELECT m.direction, m.status, m.subject, m.created_at, c.name, c.email
         FROM messages m JOIN contacts c ON c.short_guid = m.contact_guid
         ORDER BY m.created_at DESC LIMIT 12`)).rows;

    return { totalContacts, candidates, toDraft, pending, scheduled, sent7, replied, statusCounts, recent };
}
