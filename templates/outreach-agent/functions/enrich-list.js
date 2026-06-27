// Worker: qualified contacts with an email that have not been enriched from Gmail
// yet. Gated on enriched_at (set by save-knowledge) rather than "has no knowledge",
// so an imported signup that already carries account-derived facts still gets one
// Gmail pass + persona classification. Drives enrich-due's foreach; run it manually
// any time to enrich a fresh batch.
export default async function enrichList(ctx, { db }) {
    const { rows } = await db.query(
        `SELECT short_guid FROM contacts
         WHERE status IN ('new','in_sequence','replied')
           AND email IS NOT NULL
           AND enriched_at IS NULL
         ORDER BY (fit_score + engagement_score) DESC, created_at ASC
         LIMIT 25`);
    return { items: rows.map((r) => r.short_guid), count: rows.length };
}
