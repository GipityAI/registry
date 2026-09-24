// classify-incident.js - AI-powered incident classification
// Reads incident, loads categories + teams, calls LLM for classification

export default async function classifyIncident(ctx, { db, llm }) {
    const { incident_id } = ctx.body;
    // Load the incident
    const { rows: [incident] } = await db.query(
        `SELECT id, short_description, description, category_id, subcategory_id, team_id
         FROM incidents WHERE id = $1`,
        [incident_id]
    );
    if (!incident) {
        return { error: 'Incident not found' };
    }

    // Load all categories (parent + children)
    const { rows: categories } = await db.query(
        `SELECT c.id, c.name, c.parent_id, p.name as parent_name
         FROM categories c
         LEFT JOIN categories p ON c.parent_id = p.id
         WHERE c.module = 'incident' AND c.is_active = true
         ORDER BY c.parent_id NULLS FIRST, c.sort_order`
    );

    // Load all teams
    const { rows: teams } = await db.query(
        `SELECT id, name, slug FROM teams WHERE is_active = true ORDER BY name`
    );

    // Build category tree for prompt
    const topLevel = categories.filter((c) => !c.parent_id);
    const categoryTree = topLevel.map((cat) => {
        const children = categories.filter((c) => c.parent_id === cat.id);
        const childList = children.map((c) => `    - ${c.name} (id: ${c.id})`).join('\n');
        return `- ${cat.name} (id: ${cat.id})\n${childList}`;
    }).join('\n');

    const teamList = teams.map((t) => `- ${t.name} (id: ${t.id})`).join('\n');

    const prompt = `You are an IT Service Management classification engine. Classify the following incident.

INCIDENT:
Summary: ${incident.short_description}
${incident.description ? `Description: ${incident.description}` : ''}

CATEGORIES:
${categoryTree}

TEAMS:
${teamList}

Respond with ONLY valid JSON (no markdown, no explanation):
{
    "category_id": <number or null>,
    "subcategory_id": <number or null>,
    "team_id": <number>,
    "suggested_impact": <1-3, where 1=high>,
    "suggested_urgency": <1-3, where 1=high>,
    "confidence": <0.0-1.0>,
    "reasoning": "<brief explanation>"
}

Rules:
- category_id should be a top-level category
- subcategory_id should be a child of the chosen category_id
- team_id should be the most appropriate team
- Be conservative with impact/urgency unless clearly critical
- Confidence should reflect how certain you are about the classification`;

    const result = await llm({
        messages: [{ role: 'user', content: prompt }],
        model: 'claude-haiku-4-5',
        max_tokens: 256,
    });

    const content = result?.choices?.[0]?.message?.content || result?.content || '';

    // Parse JSON response
    let classification;
    try {
        // Extract JSON from possible markdown wrapper
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        classification = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch (err) {
        return { error: 'Failed to parse LLM classification response', raw: content };
    }

    // Look up priority from the matrix
    const impact = classification.suggested_impact || 3;
    const urgency = classification.suggested_urgency || 3;

    const { rows: [matrix] } = await db.query(
        `SELECT priority, priority_label FROM priority_matrix WHERE impact = $1 AND urgency = $2`,
        [impact, urgency]
    );

    classification.priority = matrix?.priority || 3;
    classification.priority_label = matrix?.priority_label || 'Moderate';

    // Update incident with AI suggestions
    await db.query(
        `UPDATE incidents SET
            ai_confidence = $1,
            ai_suggested_category = $2,
            ai_suggested_team = $3,
            updated_at = NOW()
         WHERE id = $4`,
        [
            classification.confidence,
            categories.find((c) => c.id === classification.category_id)?.name || null,
            teams.find((t) => t.id === classification.team_id)?.name || null,
            incident_id,
        ]
    );

    return {
        incident_id,
        classification,
    };
}
