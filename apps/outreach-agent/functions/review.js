// Human review of drafted emails: queue | decide
//
// decide.action:
//   approve - lock the draft (optionally edited) as 'approved'; it sends at its
//             scheduled_send_at window.
//   reject  - drop the draft. The reason is stored so the dashboard can teach the
//             agent from it (the frontend calls the platform /learn bridge).
//   comment - the headline self-improving loop. Stores the comment and flips the
//             message to 'revising'. Two things then happen, both kicked by the
//             dashboard: (1) the frontend calls POST /account/agents/:guid/learn so
//             the comment becomes a durable learned rule, and (2) the `revise-due`
//             cron redrafts THIS message honoring the comment (and the just-learned
//             rule). We don't trigger the workflow from here because a deployed app
//             can't call the platform's workflow-run endpoint cross-origin; the cron
//             picks up 'revising' messages within a couple of minutes.
export default async function review(ctx, { db }) {
    const op = ctx.body?.op || 'queue';

    if (op === 'queue') {
        const { rows } = await db.query(
            `SELECT m.short_guid, m.contact_guid, m.status, m.seq_step, m.subject, m.body,
                    m.rationale, m.comment, m.created_at, m.scheduled_send_at,
                    c.name, c.email, c.company
             FROM messages m JOIN contacts c ON c.short_guid = m.contact_guid
             WHERE m.status IN ('pending_approval','revising')
             ORDER BY m.created_at ASC`);
        return { items: rows };
    }

    if (op === 'decide') {
        const b = ctx.body || {};
        if (!b.message_guid) return { error: 'message_guid required' };
        const msg = await db.findOne('messages', { short_guid: b.message_guid });
        if (!msg) return { error: 'Not found' };
        if (msg.status !== 'pending_approval') return { error: `Message is ${msg.status}, not pending_approval` };

        if (b.action === 'approve') {
            const subject = b.edited_subject != null ? b.edited_subject : msg.subject;
            const body = b.edited_body != null ? b.edited_body : msg.body;
            await db.query(
                "UPDATE messages SET status='approved', subject=$2, body=$3 WHERE short_guid=$1",
                [b.message_guid, subject, body]);
            return { ok: true, status: 'approved' };
        }

        if (b.action === 'reject') {
            await db.query(
                "UPDATE messages SET status='rejected', reject_reason=$2 WHERE short_guid=$1",
                [b.message_guid, (b.reject_reason || '').slice(0, 4000)]);
            return { ok: true, status: 'rejected' };
        }

        if (b.action === 'comment') {
            const comment = (b.comment || '').trim();
            if (!comment) return { error: 'comment required' };
            // Flip to 'revising' so the revise-due cron redrafts it. Keep the prior
            // draft in body_original (if not already captured) so the redraft has the
            // before/after to steer from.
            await db.query(
                `UPDATE messages SET status='revising', comment=$2,
                        body_original=COALESCE(body_original, body)
                 WHERE short_guid=$1`,
                [b.message_guid, comment.slice(0, 4000)]);
            return { ok: true, status: 'revising' };
        }

        return { error: 'action must be approve, reject, or comment' };
    }

    return { error: `Unknown op: ${op}` };
}
