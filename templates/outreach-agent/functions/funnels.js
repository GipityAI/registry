// Funnels + their ordered stages, defined as data. One app can hold many funnels;
// each funnel has an ordered list of stages, and each stage carries our goal, the
// email ask, and (via topics) what to talk about. Recipients live in a funnel at a
// stage. This is the data plane behind the "4 - Funnel" builder view.
//
// ops:
//   list                          -> { funnels: [{...funnel, stages:[...]}], counts }
//   save_funnel {name,description,short_guid?} -> upsert a funnel
//   delete_funnel {short_guid}    -> delete a funnel (cascades stages) unless it holds recipients
//   set_default {short_guid}      -> mark one funnel the default (new recipients land there)
//   save_stage {funnel_guid,short_guid?,label,goal,ask,order_index?} -> upsert a stage
//   delete_stage {short_guid}     -> delete a stage unless recipients sit in it
//   reorder_stages {funnel_guid, order:[stage_guid,...]} -> set order_index by array position
function slugify(s, fallback) {
    const out = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    return out || fallback;
}

export default async function funnels(ctx, { db, guid }) {
    const op = ctx.body?.op || 'list';
    const b = ctx.body || {};

    if (op === 'list') {
        const funnelRows = (await db.query('SELECT * FROM funnels ORDER BY is_default DESC, created_at ASC')).rows;
        const stageRows = (await db.query('SELECT * FROM funnel_stages ORDER BY funnel_guid, order_index, created_at')).rows;
        const countRows = (await db.query(
            `SELECT funnel_guid, stage_guid, COUNT(*)::int AS n
             FROM contacts WHERE funnel_guid IS NOT NULL GROUP BY funnel_guid, stage_guid`)).rows;
        const topicRows = (await db.query('SELECT stage_guid, COUNT(*)::int AS n FROM topics WHERE stage_guid IS NOT NULL GROUP BY stage_guid')).rows;
        const byStage = Object.fromEntries(countRows.map((r) => [r.stage_guid, r.n]));
        const topicsByStage = Object.fromEntries(topicRows.map((r) => [r.stage_guid, r.n]));
        const stagesByFunnel = {};
        for (const s of stageRows) {
            (stagesByFunnel[s.funnel_guid] ||= []).push({
                ...s,
                recipient_count: byStage[s.short_guid] || 0,
                topic_count: topicsByStage[s.short_guid] || 0,
            });
        }
        return { funnels: funnelRows.map((f) => ({ ...f, stages: stagesByFunnel[f.short_guid] || [] })) };
    }

    if (op === 'save_funnel') {
        if (b.short_guid) {
            const { rows } = await db.query(
                'UPDATE funnels SET name=COALESCE($2,name), description=COALESCE($3,description), updated_at=NOW() WHERE short_guid=$1 RETURNING *',
                [b.short_guid, b.name ?? null, b.description ?? null]);
            return { funnel: rows[0] };
        }
        if (!b.name) return { error: 'name required' };
        const id = guid('fn');
        const anyDefault = (await db.query('SELECT 1 FROM funnels WHERE is_default LIMIT 1')).rows.length > 0;
        const { rows } = await db.query(
            'INSERT INTO funnels (short_guid, name, description, is_default) VALUES ($1,$2,$3,$4) RETURNING *',
            [id, b.name, b.description || null, !anyDefault]); // first funnel becomes default
        return { funnel: rows[0] };
    }

    if (op === 'set_default') {
        if (!b.short_guid) return { error: 'short_guid required' };
        await db.query('UPDATE funnels SET is_default=(short_guid=$1), updated_at=NOW()', [b.short_guid]);
        return { ok: true };
    }

    if (op === 'delete_funnel') {
        if (!b.short_guid) return { error: 'short_guid required' };
        const inUse = (await db.query('SELECT 1 FROM contacts WHERE funnel_guid=$1 LIMIT 1', [b.short_guid])).rows.length > 0;
        if (inUse) return { error: 'This funnel still has recipients - move or remove them first.' };
        await db.query('DELETE FROM funnels WHERE short_guid=$1', [b.short_guid]);
        return { ok: true };
    }

    if (op === 'save_stage') {
        if (b.short_guid) {
            const { rows } = await db.query(
                `UPDATE funnel_stages SET label=COALESCE($2,label), goal=COALESCE($3,goal), ask=COALESCE($4,ask),
                        order_index=COALESCE($5,order_index), updated_at=NOW() WHERE short_guid=$1 RETURNING *`,
                [b.short_guid, b.label ?? null, b.goal ?? null, b.ask ?? null,
                 b.order_index != null ? Number(b.order_index) : null]);
            return { stage: rows[0] };
        }
        if (!b.funnel_guid || !b.label) return { error: 'funnel_guid and label required' };
        const existing = (await db.query('SELECT key, order_index FROM funnel_stages WHERE funnel_guid=$1', [b.funnel_guid])).rows;
        const keys = new Set(existing.map((r) => r.key));
        let key = slugify(b.key || b.label, `stage_${existing.length + 1}`);
        while (keys.has(key)) key = `${key}_${existing.length + 1}`;
        const order = b.order_index != null ? Number(b.order_index)
            : (existing.reduce((m, r) => Math.max(m, r.order_index), -1) + 1);
        const id = guid('fs');
        const { rows } = await db.query(
            'INSERT INTO funnel_stages (short_guid, funnel_guid, order_index, key, label, goal, ask) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
            [id, b.funnel_guid, order, key, b.label, b.goal || null, b.ask || null]);
        return { stage: rows[0] };
    }

    if (op === 'delete_stage') {
        if (!b.short_guid) return { error: 'short_guid required' };
        const inUse = (await db.query('SELECT 1 FROM contacts WHERE stage_guid=$1 LIMIT 1', [b.short_guid])).rows.length > 0;
        if (inUse) return { error: 'Recipients are in this stage - move them to another stage first.' };
        await db.query('UPDATE topics SET stage_guid=NULL WHERE stage_guid=$1', [b.short_guid]);
        await db.query('DELETE FROM funnel_stages WHERE short_guid=$1', [b.short_guid]);
        return { ok: true };
    }

    if (op === 'reorder_stages') {
        const order = Array.isArray(b.order) ? b.order : [];
        for (let i = 0; i < order.length; i++) {
            await db.query('UPDATE funnel_stages SET order_index=$2, updated_at=NOW() WHERE short_guid=$1 AND funnel_guid=$3',
                [order[i], i, b.funnel_guid]);
        }
        return { ok: true };
    }

    return { error: `Unknown op: ${op}` };
}
