// Worker: the contact fields the enrich (research) llm step needs to scan Gmail and
// distill facts. Returned flat for {{load.result.*}} templating.
export default async function enrichLoad(ctx, { db }) {
    const id = ctx.body?.contact_guid;
    if (!id) return { error: 'contact_guid required' };
    const contact = await db.findOne('contacts', { short_guid: id });
    if (!contact) return { error: 'Contact not found' };

    // Facts already on file (e.g. distilled from their Gipity account on import) so
    // the research step can fold them into the persona call instead of relying on
    // Gmail alone - which is empty for a cold signup.
    const facts = (await db.query(
        'SELECT source, content FROM contact_knowledge WHERE contact_guid=$1 ORDER BY created_at ASC', [id])).rows;
    const knowledge = facts.length
        ? facts.map((f) => `- [${f.source}] ${f.content}`).join('\n')
        : '(nothing on file yet)';

    return {
        contact_guid: id,
        email: contact.email,
        name: contact.name || '(unknown)',
        company: contact.company || '(unknown)',
        notes: contact.notes || '(none)',
        stage: contact.stage || 'cold',
        knowledge,
    };
}
