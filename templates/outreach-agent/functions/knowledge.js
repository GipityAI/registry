// Hand-edit a contact's knowledge base: list | add | delete. The enrich workflow
// and reply ingestion also write here (via save-knowledge), but this lets you
// curate facts by hand from the dashboard.
export default async function knowledge(ctx, { db, guid }) {
    const op = ctx.body?.op || 'list';

    if (op === 'list') {
        const id = ctx.body?.contact_guid;
        if (!id) return { error: 'contact_guid required' };
        const { rows } = await db.query(
            'SELECT * FROM contact_knowledge WHERE contact_guid=$1 ORDER BY created_at DESC', [id]);
        return { items: rows };
    }

    if (op === 'add') {
        const id = ctx.body?.contact_guid;
        const content = (ctx.body?.content || '').trim();
        if (!id) return { error: 'contact_guid required' };
        if (!content) return { error: 'content required' };
        const contact = await db.findOne('contacts', { short_guid: id });
        if (!contact) return { error: 'Contact not found' };
        const kid = guid('kn');
        await db.query(
            "INSERT INTO contact_knowledge (short_guid, contact_guid, source, content) VALUES ($1,$2,'manual',$3)",
            [kid, id, content.slice(0, 4000)]);
        return { ok: true, short_guid: kid };
    }

    if (op === 'delete') {
        const kid = ctx.body?.knowledge_guid;
        if (!kid) return { error: 'knowledge_guid required' };
        const res = await db.query('DELETE FROM contact_knowledge WHERE short_guid=$1', [kid]);
        return { deleted: res.rowCount };
    }

    return { error: `Unknown op: ${op}` };
}
