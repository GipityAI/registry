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

    // The funnel pipeline: the default funnel's stages in order, each with how many
    // recipients sit there (and how many of those are actively being dripped).
    const funnelStages = (await db.query(
        `SELECT s.short_guid, s.order_index, s.key, s.label, s.goal,
                COUNT(c.short_guid)::int AS recipients,
                COUNT(c.short_guid) FILTER (WHERE c.status IN ('new','in_sequence'))::int AS in_drip,
                COUNT(c.short_guid) FILTER (WHERE c.status = 'replied')::int AS replied
         FROM funnel_stages s
         JOIN funnels f ON f.short_guid = s.funnel_guid AND f.is_default
         LEFT JOIN contacts c ON c.stage_guid = s.short_guid
         GROUP BY s.short_guid, s.order_index, s.key, s.label, s.goal
         ORDER BY s.order_index`)).rows;

    const recent = (await db.query(
        `SELECT m.direction, m.status, m.subject, m.created_at, c.name, c.email
         FROM messages m JOIN contacts c ON c.short_guid = m.contact_guid
         ORDER BY m.created_at DESC LIMIT 12`)).rows;

    return { totalContacts, candidates, toDraft, pending, scheduled, sent7, replied, statusCounts, funnelStages, recent };
}
