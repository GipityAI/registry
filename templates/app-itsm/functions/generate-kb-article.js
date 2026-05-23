// generate-kb-article.js - Generate a KB article from a resolved incident

export default async function generateKbArticle(ctx, { db, llm }) {
    const { incident_id } = ctx.body;
    // Load the incident with resolution details
    const { rows: [incident] } = await db.query(
        `SELECT i.id, i.number, i.short_description, i.description,
                i.resolution_notes, i.resolution_code,
                c.name as category_name, sc.name as subcategory_name
         FROM incidents i
         LEFT JOIN categories c ON i.category_id = c.id
         LEFT JOIN categories sc ON i.subcategory_id = sc.id
         WHERE i.id = $1`,
        [incident_id]
    );

    if (!incident) {
        return { error: 'Incident not found' };
    }

    if (!incident.resolution_notes) {
        return { error: 'Incident has no resolution notes', incident_id };
    }

    // Load work notes for additional context
    const { rows: workNotes } = await db.query(
        `SELECT body, author_name, created_at
         FROM comments
         WHERE target_table = 'incidents' AND target_id = $1
           AND comment_type = 'work_note'
         ORDER BY created_at ASC
         LIMIT 10`,
        [incident_id]
    );

    const workNotesText = workNotes.length > 0
        ? '\n\nWORK NOTES:\n' + workNotes.map((n) => `[${n.author_name || 'Agent'}]: ${n.body}`).join('\n')
        : '';

    const prompt = `You are a technical writer creating a knowledge base article from a resolved IT incident.

INCIDENT ${incident.number}:
Summary: ${incident.short_description}
${incident.description ? `Description: ${incident.description}` : ''}
Category: ${incident.category_name || 'N/A'} ${incident.subcategory_name ? `> ${incident.subcategory_name}` : ''}
Resolution: ${incident.resolution_notes}
${workNotesText}

Generate a KB article as valid JSON (no markdown wrapper):
{
    "title": "<clear, searchable title>",
    "body": "<HTML content with h2, h3, p, ol, ul, li, code tags. Include: problem description, symptoms, step-by-step solution, prevention tips if applicable>",
    "category": "<category name>"
}

Guidelines:
- Title should be action-oriented (e.g., "How to Fix..." or "Resolving...")
- Body should be helpful to someone encountering the same issue
- Use semantic HTML tags for structure
- Include specific steps, not vague instructions
- Keep it concise but complete`;

    const result = await llm({
        messages: [{ role: 'user', content: prompt }],
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
    });

    const content = result?.choices?.[0]?.message?.content || result?.content || '';

    let article;
    try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        article = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
        return { error: 'Failed to parse KB article response', raw: content };
    }

    // Insert as draft
    const { rows: [newArticle] } = await db.query(
        `INSERT INTO knowledge_articles (title, body, category, state, source_incident_id, visibility)
         VALUES ($1, $2, $3, 'draft', $4, 'public')
         RETURNING id, number, title`,
        [article.title, article.body, article.category || incident.category_name, incident_id]
    );

    // Add work note to the incident
    await db.query(
        `INSERT INTO comments (target_table, target_id, comment_type, body, author_name, is_ai_generated)
         VALUES ('incidents', $1, 'work_note', $2, 'KB Generator', true)`,
        [incident_id, `Draft KB article generated: ${newArticle.number} - ${newArticle.title}. Review and publish from the Knowledge Base.`]
    );

    return {
        incident_id,
        article_id: newArticle.id,
        article_number: newArticle.number,
        title: newArticle.title,
        state: 'draft',
    };
}
