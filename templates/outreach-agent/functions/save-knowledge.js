// Worker: persist the facts the enrich (research) llm step distilled from Gmail into
// the contact's knowledge base, one row per fact, deduped against what's already
// stored. The only place gmail-sourced knowledge enters the system.
import { extractJson, findArray } from './_lib/json.js';

export default async function saveKnowledge(ctx, { db, guid }) {
    const contactGuid = ctx.body?.contact_guid;
    if (!contactGuid) return { error: 'contact_guid required' };
    const source = ctx.body?.source || 'gmail';
    const contact = await db.findOne('contacts', { short_guid: contactGuid });
    if (!contact) return { error: 'Contact not found' };

    const parsed = extractJson(ctx.body?.research) || {};

    // Stamp the Gmail-enrich pass as done (gmail source only) so the enrich queue
    // doesn't keep re-listing this contact - mark it even when nothing usable came
    // back. The persona classification (when it produced a known value) lands in the
    // same update; 'unknown' is left untouched so we never clobber a real persona.
    const PERSONAS = ['investor', 'developer', 'designer', 'games', 'enterprise'];
    const persona = String(parsed.persona || '').trim().toLowerCase();
    if (source === 'gmail') {
        if (PERSONAS.includes(persona)) {
            await db.query('UPDATE contacts SET persona=$2, enriched_at=NOW(), updated_at=NOW() WHERE short_guid=$1', [contactGuid, persona]);
        } else {
            await db.query('UPDATE contacts SET enriched_at=NOW(), updated_at=NOW() WHERE short_guid=$1', [contactGuid]);
        }
    }

    const facts = findArray(parsed, 'facts')
        .map((f) => (typeof f === 'string' ? f : (f && (f.content || f.fact || f.text)) || ''))
        .map((s) => String(s).trim())
        .filter(Boolean)
        .slice(0, 25);
    if (!facts.length) return { added: 0, found: 0 };

    // Dedupe against existing knowledge (case-insensitive exact content match).
    const existing = new Set(
        (await db.query('SELECT lower(content) AS c FROM contact_knowledge WHERE contact_guid=$1', [contactGuid])).rows.map((r) => r.c));

    const fresh = [];
    const seen = new Set();
    for (const content of facts) {
        const key = content.toLowerCase();
        if (existing.has(key) || seen.has(key)) continue;
        seen.add(key);
        fresh.push(content.slice(0, 4000));
    }
    if (!fresh.length) return { added: 0, found: facts.length };

    const params = [];
    const tuples = fresh.map((content) => {
        const b = params.length;
        params.push(guid('kn'), contactGuid, source, content);
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4})`;
    });
    const res = await db.query(
        `INSERT INTO contact_knowledge (short_guid, contact_guid, source, content) VALUES ${tuples.join(',')}`, params);
    return { added: res.rowCount, found: facts.length };
}
