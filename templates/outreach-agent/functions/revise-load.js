// Worker: gather everything the redraft llm step needs for ONE commented message -
// the same contact context as a fresh draft PLUS the prior draft and the human's
// comment as steering. Returned flat for {{load.result.*}} templating.
export default async function reviseLoad(ctx, { db }) {
    const mid = ctx.body?.message_guid;
    if (!mid) return { error: 'message_guid required' };
    const msg = await db.findOne('messages', { short_guid: mid });
    if (!msg) return { error: 'Message not found' };
    const contact = await db.findOne('contacts', { short_guid: msg.contact_guid });
    if (!contact) return { error: 'Contact not found' };

    const s = (await db.query('SELECT * FROM settings WHERE id=1')).rows[0] || {};
    const facts = (await db.query(
        'SELECT source, content FROM contact_knowledge WHERE contact_guid=$1 ORDER BY created_at ASC', [msg.contact_guid])).rows;
    const steps = (await db.query('SELECT step_number, label, instruction FROM sequence_steps ORDER BY step_number')).rows;
    const idx = steps.length ? Math.min(msg.seq_step || 0, steps.length - 1) : 0;
    const step = steps[idx] || { label: 'Intro', instruction: 'Write a warm first touch.' };

    const knowledge = facts.length
        ? facts.map((f) => `- [${f.source}] ${f.content}`).join('\n')
        : '(no knowledge gathered yet - keep the email general and do not invent facts about them)';

    return {
        message_guid: mid,
        name: contact.name || '(unknown)',
        email: contact.email,
        company: contact.company || '(unknown)',
        title: contact.title || '(unknown)',
        knowledge,
        touch_label: step.label,
        instruction: step.instruction,
        prior_subject: msg.subject || '',
        prior_body: msg.body_original || msg.body || '',
        comment: msg.comment || '',
        base_ask: s.base_ask || 'Try the product and share honest feedback.',
        product_name: s.product_name || 'Gipity',
        product_url: s.product_url || 'https://gipity.ai',
        signature: s.signature || s.sender_name || 'me',
        model: s.model || 'claude-sonnet-4-6',
    };
}
