// Single-row settings: get | save. The workflows and dashboard both read this.
export default async function settings(ctx, { db }) {
    const op = ctx.body?.op || 'get';
    if (op === 'get') {
        const { rows } = await db.query('SELECT * FROM settings WHERE id=1');
        return { settings: rows[0] || null };
    }
    if (op === 'save') {
        const b = ctx.body || {};
        const { rows } = await db.query(
            `UPDATE settings SET
                base_ask=COALESCE($1, base_ask),
                product_name=COALESCE($2, product_name),
                product_url=COALESCE($3, product_url),
                sender_name=COALESCE($4, sender_name),
                signature=COALESCE($5, signature),
                model=COALESCE($6, model),
                default_cadence=COALESCE($7, default_cadence),
                draft_lead_days=COALESCE($8, draft_lead_days),
                daily_send_cap=COALESCE($9, daily_send_cap),
                draft_cap=COALESCE($10, draft_cap),
                notify_email=COALESCE($11, notify_email),
                agent_name=COALESCE($12, agent_name),
                agent_guid=COALESCE($13, agent_guid),
                app_url=COALESCE($14, app_url),
                updated_at=NOW()
             WHERE id=1 RETURNING *`,
            [b.base_ask ?? null, b.product_name ?? null, b.product_url ?? null,
             b.sender_name ?? null, b.signature ?? null, b.model ?? null,
             b.default_cadence ?? null,
             b.draft_lead_days != null ? Number(b.draft_lead_days) : null,
             b.daily_send_cap != null ? Number(b.daily_send_cap) : null,
             b.draft_cap != null ? Number(b.draft_cap) : null,
             b.notify_email ?? null, b.agent_name ?? null, b.agent_guid ?? null,
             b.app_url ?? null]);
        return { settings: rows[0] };
    }
    return { error: `Unknown op: ${op}` };
}
