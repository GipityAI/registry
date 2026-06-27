// Topics library CRUD: list | save | toggle | delete. Topics are the things outreach
// can be ABOUT; the draft step picks an active one matching a contact's (stage,
// persona). A null audience_stage / audience_persona means "fits any". The dashboard
// Topics panel reads/writes this.
const STAGES = ['cold', 'signed_up', 'active'];
const PERSONAS = ['investor', 'developer', 'designer', 'games', 'enterprise', 'unknown'];

// Empty string / 'any' from the form -> NULL (fits any); otherwise validate.
function audience(v, allowed) {
    const s = String(v ?? '').trim().toLowerCase();
    if (!s || s === 'any') return null;
    return allowed.includes(s) ? s : null;
}

export default async function topics(ctx, { db, guid }) {
    const op = ctx.body?.op || 'list';
    if (op === 'list') {
        const { rows } = await db.query(
            'SELECT * FROM topics ORDER BY active DESC, updated_at DESC, created_at DESC');
        return { topics: rows };
    }
    if (op === 'save') {
        const b = ctx.body || {};
        const title = String(b.title || '').trim();
        if (!title) return { error: 'Title is required.' };
        const body = (b.body || '').trim() || null;
        const stage = audience(b.audience_stage, STAGES);
        const persona = audience(b.audience_persona, PERSONAS);

        if (b.short_guid) {
            const { rows } = await db.query(
                `UPDATE topics SET title=$2, body=$3, audience_stage=$4, audience_persona=$5, updated_at=NOW()
                 WHERE short_guid=$1 RETURNING *`,
                [b.short_guid, title.slice(0, 200), body, stage, persona]);
            if (!rows.length) return { error: 'Topic not found.' };
            return { topic: rows[0] };
        }
        const id = guid('tp');
        const { rows } = await db.query(
            `INSERT INTO topics (short_guid, title, body, audience_stage, audience_persona)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [id, title.slice(0, 200), body, stage, persona]);
        return { topic: rows[0] };
    }
    if (op === 'toggle') {
        const id = ctx.body?.short_guid;
        if (!id) return { error: 'short_guid required' };
        const { rows } = await db.query(
            'UPDATE topics SET active = NOT active, updated_at=NOW() WHERE short_guid=$1 RETURNING *', [id]);
        if (!rows.length) return { error: 'Topic not found.' };
        return { topic: rows[0] };
    }
    if (op === 'delete') {
        const id = ctx.body?.short_guid;
        if (!id) return { error: 'short_guid required' };
        const res = await db.query('DELETE FROM topics WHERE short_guid=$1', [id]);
        return { deleted: res.rowCount };
    }
    return { error: `Unknown op: ${op}` };
}
