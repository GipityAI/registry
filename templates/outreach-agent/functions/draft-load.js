// Worker: gather everything the draft llm step needs for ONE contact and return it
// as flat, template-friendly fields. The llm step reads these via {{load.result.*}}
// and writes the email from the stored knowledge - no live Gmail call on this path.
export default async function draftLoad(ctx, { db }) {
    const id = ctx.body?.contact_guid;
    if (!id) return { error: 'contact_guid required' };
    const contact = await db.findOne('contacts', { short_guid: id });
    if (!contact) return { error: 'Contact not found' };

    const s = (await db.query('SELECT * FROM settings WHERE id=1')).rows[0] || {};
    const facts = (await db.query(
        'SELECT source, content FROM contact_knowledge WHERE contact_guid=$1 ORDER BY created_at ASC', [id])).rows;
    const steps = (await db.query(
        'SELECT step_number, label, instruction FROM sequence_steps ORDER BY step_number')).rows;

    const idx = steps.length ? Math.min(contact.seq_step || 0, steps.length - 1) : 0;
    const step = steps[idx] || { label: 'Intro', instruction: 'Write a warm first touch.' };

    // Prior outbound subjects so a follow-up does not repeat an earlier touch.
    const priorSubjects = (await db.query(
        "SELECT subject FROM messages WHERE contact_guid=$1 AND direction='outbound' AND status='sent' ORDER BY created_at ASC", [id]
    )).rows.map((r) => `- ${r.subject || '(no subject)'}`).join('\n') || '(none yet - this is the first touch)';

    const knowledge = facts.length
        ? facts.map((f) => `- [${f.source}] ${f.content}`).join('\n')
        : '(no knowledge gathered yet - keep the email general and do not invent facts about them)';

    return {
        contact_guid: id,
        name: contact.name || '(unknown)',
        email: contact.email,
        company: contact.company || '(unknown)',
        title: contact.title || '(unknown)',
        notes: contact.notes || '(none)',
        knowledge,
        prior_subjects: priorSubjects,
        touch_label: step.label,
        touch_number: idx + 1,
        total_touches: steps.length,
        instruction: step.instruction,
        seq_step: idx,
        base_ask: s.base_ask || 'Try the product and share honest feedback.',
        product_name: s.product_name || 'Gipity',
        product_url: s.product_url || 'https://gipity.ai',
        sender_name: s.sender_name || 'me',
        signature: s.signature || s.sender_name || 'me',
        model: s.model || 'claude-sonnet-4-6',
    };
}
