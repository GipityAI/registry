// Worker: messages a human commented on (status 'revising'), waiting to be redrafted.
// Drives the revise-due workflow's foreach. Each one carries the prior draft + the
// comment so the draft llm step can steer the rewrite.
export default async function reviseList(ctx, { db }) {
    const { rows } = await db.query(
        `SELECT short_guid FROM messages WHERE status='revising'
         ORDER BY created_at ASC LIMIT 25`);
    return { items: rows.map((r) => r.short_guid), count: rows.length };
}
