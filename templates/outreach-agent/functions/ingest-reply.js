// Worker: take inbound emails the check-replies llm step scanned (JSON), match them
// to known contacts, and for each match: log the inbound message, append it to that
// contact's knowledge (source 'reply'), and mark the contact 'replied' - which STOPS
// their follow-up sequence. Returns a summary the workflow emails to you immediately.
// Idempotent: skips replies already logged. You reply from your personal Gmail (V1).
import { extractJson, findArray } from './_lib/json.js';

function emailOf(r) {
    const raw = String(r.email || r.from || '');
    const m = raw.match(/[^\s<>"]+@[^\s<>"]+/);
    return m ? m[0].trim().toLowerCase() : '';
}

export default async function ingestReply(ctx, { db, guid }) {
    const list = findArray(extractJson(ctx.body?.replies) || {}, 'replies').slice(0, 25);
    if (!list.length) return { matched: 0, found: 0, summary: '' };

    let matched = 0;
    const items = [];
    for (const r of list) {
        const email = emailOf(r);
        if (!email) continue;
        const contact = await db.findOne('contacts', { email });
        if (!contact) continue;

        const body = String(r.body || '').slice(0, 5000);
        const dup = await db.query(
            "SELECT 1 FROM messages WHERE contact_guid=$1 AND direction='inbound' AND body=$2 LIMIT 1",
            [contact.short_guid, body]);
        if (dup.rows.length) continue;
        matched++;

        await db.query(
            "INSERT INTO messages (short_guid, contact_guid, direction, status, subject, body) VALUES ($1,$2,'inbound','logged',$3,$4)",
            [guid('msg'), contact.short_guid, r.subject || null, body]);
        if (body.trim()) {
            await db.query(
                "INSERT INTO contact_knowledge (short_guid, contact_guid, source, content) VALUES ($1,$2,'reply',$3)",
                [guid('kn'), contact.short_guid, `They replied: ${body.slice(0, 800)}`]);
        }
        // A reply pauses the sequence (no more auto follow-ups) and you take over.
        await db.query(
            "UPDATE contacts SET status='replied', next_contact_at=NULL, engagement_score=LEAST(100, engagement_score + 40), updated_at=NOW() WHERE short_guid=$1",
            [contact.short_guid]);
        items.push({ name: contact.name || email, email, subject: r.subject || '', snippet: body.slice(0, 200) });
    }

    const summary = items.length
        ? items.map((i) => `- ${i.name} <${i.email}>: ${i.subject}\n  ${i.snippet}`).join('\n\n')
        : '';
    return { matched, found: list.length, summary, items };
}
