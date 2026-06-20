// Imported contacts awaiting qualification (status='to_qualify') before the agent
// sequences them. This is where you pick your ~5. list | approve | reject | approve_all
export default async function candidates(ctx, { db }) {
    const op = ctx.body?.op || 'list';

    if (op === 'list') {
        const { rows } = await db.query(
            "SELECT * FROM contacts WHERE status='to_qualify' ORDER BY fit_score DESC, created_at DESC LIMIT 500");
        return { items: rows };
    }

    // Qualify a contact: move to 'new', start the sequence, make them due now (the
    // enrich + draft crons pick them up from here).
    if (op === 'approve') {
        const id = ctx.body?.contact_guid;
        if (!id) return { error: 'contact_guid required' };
        const { rows } = await db.query(
            `UPDATE contacts SET status='new', seq_step=0, next_contact_at=NOW(), updated_at=NOW()
             WHERE short_guid=$1 AND status='to_qualify' AND email IS NOT NULL RETURNING *`, [id]);
        if (!rows.length) return { error: 'Not a pending candidate with an email' };
        return { ok: true, contact: rows[0] };
    }

    if (op === 'reject') {
        const id = ctx.body?.contact_guid;
        if (!id) return { error: 'contact_guid required' };
        await db.query(
            "UPDATE contacts SET status='disqualified', next_contact_at=NULL, updated_at=NOW() WHERE short_guid=$1 AND status='to_qualify'",
            [id]);
        return { ok: true };
    }

    if (op === 'approve_all') {
        const { rows } = await db.query(
            "UPDATE contacts SET status='new', seq_step=0, next_contact_at=NOW(), updated_at=NOW() WHERE status='to_qualify' AND email IS NOT NULL RETURNING short_guid");
        return { approved: rows.length };
    }

    return { error: `Unknown op: ${op}` };
}
