// analyze-sentiment.js - Analyze comment sentiment using LLM
// Run by the "Sentiment Escalation" workflow on each new comment (auth: member).
// A negative, escalation-worthy comment on an incident raises its escalation
// level, adds a work note, and notifies the assigned agent.

async function setting(db, key, fallback) {
    const { rows: [row] } = await db.query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
    return row ? row.value : fallback;
}

export default async function analyzeSentiment(ctx, { db, llm }) {
    const { comment_id } = ctx.body;
    if (!(await setting(db, 'ai_sentiment_enabled', false))) {
        return { comment_id, skipped: true, reason: 'AI sentiment analysis is off' };
    }
    // Load the comment
    const { rows: [comment] } = await db.query(
        `SELECT id, target_table, target_id, body, author_name, comment_type
         FROM comments WHERE id = $1`,
        [comment_id]
    );
    if (!comment) {
        return { error: 'Comment not found' };
    }

    // Skip work notes and AI-generated comments
    if (comment.comment_type === 'work_note') {
        return { comment_id, skipped: true, reason: 'Work notes are not analyzed for sentiment' };
    }

    const prompt = `Analyze the sentiment of this IT support comment. Classify it as positive, neutral, or negative.

COMMENT:
"${comment.body}"

Respond with ONLY valid JSON (no markdown):
{
    "sentiment": "positive" | "neutral" | "negative",
    "confidence": <0.0-1.0>,
    "indicators": ["<key phrases or patterns that indicate the sentiment>"],
    "escalation_recommended": <true if the user appears frustrated, angry, or threatened>
}`;

    const result = await llm({
        messages: [{ role: 'user', content: prompt }],
        model: 'small',
        max_tokens: 400,
        response_format: { type: 'json_object' },
    });

    const content = result?.text || '';

    let analysis;
    try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        analysis = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
        return { error: 'Failed to parse sentiment response', raw: content };
    }

    const escalate = analysis.escalation_recommended === true;
    const onIncident = comment.target_table === 'incidents';

    if (analysis.sentiment === 'negative') {
        await db.query(
            `INSERT INTO comments (target_table, target_id, comment_type, body, author_name, is_ai_generated)
             VALUES ($1, $2, 'work_note', $3, 'Workflow: Sentiment Analysis', true)`,
            [
                comment.target_table,
                comment.target_id,
                `Sentiment analysis: negative (confidence: ${analysis.confidence}). Indicators: ${(analysis.indicators || []).join(', ')}.`,
            ]
        );
    }

    if (escalate && onIncident) {
        await db.query(
            `UPDATE incidents SET escalation_level = GREATEST(escalation_level, 1), updated_at = NOW() WHERE id = $1`,
            [comment.target_id]
        );
        await db.query(
            `INSERT INTO notifications (user_id, title, body, link)
             SELECT assigned_to, 'Negative sentiment on ' || number,
                    'A comment shows signs of frustration. Review and respond promptly.', '/agent/incidents'
             FROM incidents WHERE id = $1 AND assigned_to IS NOT NULL`,
            [comment.target_id]
        );
    }

    return {
        comment_id,
        target_table: comment.target_table,
        target_id: comment.target_id,
        sentiment: analysis.sentiment,
        confidence: analysis.confidence,
        indicators: analysis.indicators,
        escalation_recommended: escalate,
        escalated: escalate && onIncident,
    };
}
