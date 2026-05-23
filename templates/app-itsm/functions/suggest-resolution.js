// suggest-resolution.js - Search KB and similar resolved incidents, synthesize resolution suggestion

export default async function suggestResolution(ctx, { db, llm }) {
    const { incident_id } = ctx.body;
    // Load the incident
    const { rows: [incident] } = await db.query(
        `SELECT id, number, short_description, description, category_id, subcategory_id
         FROM incidents WHERE id = $1`,
        [incident_id]
    );
    if (!incident) {
        return { error: 'Incident not found' };
    }

    const searchTerms = `${incident.short_description} ${incident.description || ''}`.trim();

    // Search KB articles using full-text search
    const { rows: kbArticles } = await db.query(
        `SELECT id, number, title, body,
                ts_rank(to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(body, '')),
                        plainto_tsquery('english', $1)) as rank
         FROM knowledge_articles
         WHERE state = 'published'
           AND to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(body, ''))
               @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT 3`,
        [searchTerms]
    );

    // Search recently resolved similar incidents
    const { rows: similarIncidents } = await db.query(
        `SELECT id, number, short_description, resolution_notes, resolution_code
         FROM incidents
         WHERE state IN ('resolved', 'closed')
           AND resolution_notes IS NOT NULL
           AND id != $1
           AND (category_id = $2 OR subcategory_id = $3)
         ORDER BY resolved_at DESC
         LIMIT 5`,
        [incident_id, incident.category_id, incident.subcategory_id || incident.category_id]
    );

    // Build context for LLM
    let kbContext = '';
    if (kbArticles.length > 0) {
        kbContext = '\n\nRELEVANT KNOWLEDGE ARTICLES:\n' +
            kbArticles.map((a) => `--- ${a.title} (${a.number}) ---\n${(a.body || '').replace(/<[^>]+>/g, '').slice(0, 500)}`).join('\n\n');
    }

    let similarContext = '';
    if (similarIncidents.length > 0) {
        similarContext = '\n\nSIMILAR RESOLVED INCIDENTS:\n' +
            similarIncidents.map((i) => `--- ${i.number}: ${i.short_description} ---\nResolution: ${(i.resolution_notes || '').slice(0, 300)}`).join('\n\n');
    }

    if (!kbContext && !similarContext) {
        return {
            incident_id,
            suggestion: 'No matching knowledge articles or similar resolved incidents found. Manual investigation recommended.',
            kb_matches: 0,
            similar_matches: 0,
        };
    }

    const prompt = `You are an IT support resolution assistant. Based on the incident and available knowledge, suggest a resolution.

INCIDENT:
Number: ${incident.number}
Summary: ${incident.short_description}
${incident.description ? `Description: ${incident.description}` : ''}
${kbContext}
${similarContext}

Provide a clear, actionable resolution suggestion. Include:
1. Most likely root cause
2. Step-by-step resolution steps
3. If the knowledge articles are relevant, reference them by number
4. Any preventive measures

Keep the response concise and practical (under 200 words).`;

    const result = await llm({
        messages: [{ role: 'user', content: prompt }],
        model: 'claude-haiku-4-5',
        max_tokens: 512,
    });

    const suggestion = result?.choices?.[0]?.message?.content || result?.content || 'Unable to generate suggestion.';

    return {
        incident_id,
        suggestion,
        kb_matches: kbArticles.length,
        similar_matches: similarIncidents.length,
        kb_articles: kbArticles.map((a) => ({ number: a.number, title: a.title })),
        similar_incidents: similarIncidents.map((i) => ({ number: i.number, summary: i.short_description })),
    };
}
