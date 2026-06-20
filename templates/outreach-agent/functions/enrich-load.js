// Worker: the contact fields the enrich (research) llm step needs to scan Gmail and
// distill facts. Returned flat for {{load.result.*}} templating.
export default async function enrichLoad(ctx, { db }) {
    const id = ctx.body?.contact_guid;
    if (!id) return { error: 'contact_guid required' };
    const contact = await db.findOne('contacts', { short_guid: id });
    if (!contact) return { error: 'Contact not found' };
    return {
        contact_guid: id,
        email: contact.email,
        name: contact.name || '(unknown)',
        company: contact.company || '(unknown)',
        notes: contact.notes || '(none)',
    };
}
