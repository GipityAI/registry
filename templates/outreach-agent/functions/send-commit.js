// Worker: after the send step delivered the claimed batch, mark every 'sending'
// message 'sent', advance each contact one touch, and set next_contact_at using the
// re-engagement schedule (fast for the first few touches, then monthly). The sequence
// never auto-finishes here - a reply (ingest-reply) or unsubscribe stops it instead.
import { addDays, intervalForStep } from './_lib/cadence.js';

export default async function sendCommit(ctx, { db }) {
    const { rows } = await db.query(
        "SELECT short_guid, contact_guid FROM messages WHERE status='sending'");
    let sent = 0;
    for (const m of rows) {
        await db.query(
            "UPDATE messages SET status='sent', sent_at=NOW() WHERE short_guid=$1", [m.short_guid]);
        const contact = await db.findOne('contacts', { short_guid: m.contact_guid });
        if (contact) {
            const seqStep = contact.seq_step || 0;
            const days = intervalForStep(seqStep, contact.cadence); // null only if paused
            const next = days == null ? null : addDays(null, days);
            const status = contact.status === 'new' ? 'in_sequence' : contact.status;
            await db.query(
                `UPDATE contacts SET last_contacted_at=NOW(), next_contact_at=$2, status=$3, seq_step=$4,
                        engagement_score=LEAST(100, engagement_score + 5), updated_at=NOW()
                 WHERE short_guid=$1`,
                [m.contact_guid, next, status, seqStep + 1]);
        }
        sent++;
    }
    return { sent };
}
