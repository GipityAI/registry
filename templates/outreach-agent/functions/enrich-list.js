// Worker: qualified contacts that have an email but no knowledge gathered yet.
// Drives enrich-due's foreach so each gets enriched from Gmail exactly once. (Run
// enrich-due manually any time to (re)enrich a fresh batch.)
export default async function enrichList(ctx, { db }) {
    const { rows } = await db.query(
        `SELECT short_guid FROM contacts
         WHERE status IN ('new','in_sequence','replied')
           AND email IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM contact_knowledge k WHERE k.contact_guid = contacts.short_guid)
         ORDER BY (fit_score + engagement_score) DESC, created_at ASC
         LIMIT 25`);
    return { items: rows.map((r) => r.short_guid), count: rows.length };
}
