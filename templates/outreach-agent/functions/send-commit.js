// Worker: after notify delivered the claimed batch, mark every 'sending' message
// 'sent', advance each contact's sequence to the next touch (or finish the sequence),
// and set next_contact_at = now + the contact's cadence (the next 3-day mark).
import { addDays, intervalDays, advanceStep } from './_lib/cadence.js';

export default async function sendCommit(ctx, { db }) {
    const numSteps = (await db.query('SELECT COUNT(*)::int AS n FROM sequence_steps')).rows[0].n;
    const { rows } = await db.query(
        "SELECT short_guid, contact_guid FROM messages WHERE status='sending'");
    let sent = 0;
    for (const m of rows) {
        await db.query(
            "UPDATE messages SET status='sent', sent_at=NOW() WHERE short_guid=$1", [m.short_guid]);
        const contact = await db.findOne('contacts', { short_guid: m.contact_guid });
        if (contact) {
            const { seq_step, done } = advanceStep(numSteps, contact.seq_step || 0);
            const days = intervalDays(contact.cadence);
            // Sequence exhausted, or paused cadence -> stop sending (status 'done').
            const finished = done || days == null;
            const next = finished ? null : addDays(null, days);
            const status = finished ? 'done' : (contact.status === 'new' ? 'in_sequence' : contact.status);
            await db.query(
                `UPDATE contacts SET last_contacted_at=NOW(), next_contact_at=$2, status=$3, seq_step=$4,
                        engagement_score=LEAST(100, engagement_score + 5), updated_at=NOW()
                 WHERE short_guid=$1`,
                [m.contact_guid, next, status, seq_step]);
        }
        sent++;
    }
    return { sent };
}
