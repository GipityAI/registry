// Worker: take the draft llm step's JSON output and save it as a pending_approval
// message for review. Stamps scheduled_send_at = the contact's next_contact_at (the
// cadence mark) so the send window knows when it should go out.
import { extractJson } from './_lib/json.js';

export default async function draftSave(ctx, { db, guid }) {
    const contactGuid = ctx.body?.contact_guid;
    if (!contactGuid) return { error: 'contact_guid required' };
    const contact = await db.findOne('contacts', { short_guid: contactGuid });
    if (!contact) return { error: 'Contact not found' };

    let parsed = extractJson(ctx.body?.draft) || {};
    // The llm step's output can arrive wrapped as { result: {subject, body, ...} };
    // unwrap it so we read the fields whether or not the envelope is present.
    if ((!parsed.subject || !parsed.body) && parsed.result) parsed = extractJson(parsed.result) || parsed;
    const subject = typeof parsed.subject === 'string' ? parsed.subject.trim() : '';
    const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
    const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '';
    if (!subject || !body) return { error: 'The model did not return a usable draft (subject + body).' };

    const s = (await db.query('SELECT model FROM settings WHERE id=1')).rows[0] || {};
    const id = guid('msg');
    await db.query(
        `INSERT INTO messages
            (short_guid, contact_guid, direction, status, seq_step, subject, body, body_original, rationale, model, scheduled_send_at)
         VALUES ($1,$2,'outbound','pending_approval',$3,$4,$5,$5,$6,$7,$8)`,
        [id, contactGuid, contact.seq_step || 0, subject, body, rationale, s.model || 'claude-sonnet-4-6', contact.next_contact_at]);
    return { message_guid: id, contact_guid: contactGuid, subject };
}
