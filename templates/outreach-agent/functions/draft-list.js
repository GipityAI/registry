// Worker: contact_guids that are due for their next touch and have no draft waiting.
// "Due" = next_contact_at minus the draft-lead window has arrived, so we draft a day
// early and you have time to approve before the send mark. Drives draft-due's foreach.
export default async function draftList(ctx, { db }) {
    const s = (await db.query('SELECT draft_lead_days, draft_cap FROM settings WHERE id=1')).rows[0] || {};
    const cap = Math.min(Number(s.draft_cap) || 20, 25); // workflow foreach caps at 25
    const lead = Number(s.draft_lead_days) || 0;
    const { rows } = await db.query(
        `SELECT short_guid FROM contacts
         WHERE status IN ('new','in_sequence')
           AND email IS NOT NULL
           AND next_contact_at IS NOT NULL
           AND next_contact_at - make_interval(days => $1) <= NOW()
           AND short_guid NOT IN (
               SELECT contact_guid FROM messages
               WHERE status IN ('pending_approval','revising','approved','sending')
           )
         ORDER BY (fit_score + engagement_score) DESC, next_contact_at ASC
         LIMIT $2`, [lead, cap]);
    return { items: rows.map((r) => r.short_guid), count: rows.length };
}
