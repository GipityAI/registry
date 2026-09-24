// Topics library CRUD: list | save | toggle | delete. Topics are the things outreach
// can be ABOUT; each topic hangs off a funnel STAGE (topics.stage_guid). The draft
// step picks an active topic for the recipient's stage (a NULL stage_guid = a general
// topic usable at any stage). The dashboard's per-stage Topics editor reads/writes this.
export default async function topics(ctx, { db, guid }) {
    const op = ctx.body?.op || 'list';
    if (op === 'list') {
        // Optional filter by stage for the per-stage editor in the Funnel view.
        if (ctx.body?.stage_guid) {
            const { rows } = await db.query(
                'SELECT * FROM topics WHERE stage_guid=$1 ORDER BY active DESC, updated_at DESC', [ctx.body.stage_guid]);
            return { topics: rows };
        }
        const { rows } = await db.query(
            'SELECT * FROM topics ORDER BY active DESC, updated_at DESC, created_at DESC');
        return { topics: rows };
    }
    if (op === 'save') {
        const b = ctx.body || {};
        const title = String(b.title || '').trim();
        if (!title) return { error: 'Title is required.' };
        const body = (b.body || '').trim() || null;
        const stageGuid = String(b.stage_guid || '').trim() || null; // null = any stage

        if (b.short_guid) {
            const { rows } = await db.query(
                `UPDATE topics SET title=$2, body=$3, stage_guid=$4, updated_at=NOW()
                 WHERE short_guid=$1 RETURNING *`,
                [b.short_guid, title.slice(0, 200), body, stageGuid]);
            if (!rows.length) return { error: 'Topic not found.' };
            return { topic: rows[0] };
        }
        const id = guid('tp');
        const { rows } = await db.query(
            `INSERT INTO topics (short_guid, title, body, stage_guid) VALUES ($1,$2,$3,$4) RETURNING *`,
            [id, title.slice(0, 200), body, stageGuid]);
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
