// analyze-sentiment.js - Analyze comment sentiment using LLM

export default async function analyzeSentiment(ctx, { db, llm }) {
    const { comment_id } = ctx.body;
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
        model: 'claude-haiku-4-5',
        max_tokens: 200,
    });

    const content = result?.choices?.[0]?.message?.content || result?.content || '';

    let analysis;
    try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        analysis = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
        return { error: 'Failed to parse sentiment response', raw: content };
    }

    return {
        comment_id,
        target_table: comment.target_table,
        target_id: comment.target_id,
        sentiment: analysis.sentiment,
        confidence: analysis.confidence,
        indicators: analysis.indicators,
        escalation_recommended: analysis.escalation_recommended || false,
    };
}
