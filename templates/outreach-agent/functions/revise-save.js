// Worker: take the redraft llm step's JSON and update the SAME message back to
// pending_approval so it returns to the review queue - now honoring the comment (and
// the rule it just taught the agent). Does not create a new message row.
import { extractJson } from './_lib/json.js';

export default async function reviseSave(ctx, { db }) {
    const mid = ctx.body?.message_guid;
    if (!mid) return { error: 'message_guid required' };
    const msg = await db.findOne('messages', { short_guid: mid });
    if (!msg) return { error: 'Message not found' };

    let parsed = extractJson(ctx.body?.draft) || {};
    // The llm step's output can arrive wrapped as { result: {subject, body, ...} }.
    if ((!parsed.subject || !parsed.body) && parsed.result) parsed = extractJson(parsed.result) || parsed;
    const subject = typeof parsed.subject === 'string' ? parsed.subject.trim() : '';
    const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
    const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '';
    if (!subject || !body) {
        // Leave it as 'revising' so the next cron pass retries rather than losing it.
        return { error: 'The model did not return a usable redraft.' };
    }

    await db.query(
        `UPDATE messages SET status='pending_approval', subject=$2, body=$3,
                rationale=COALESCE(NULLIF($4,''), rationale)
         WHERE short_guid=$1`,
        [mid, subject, body, rationale]);
    return { message_guid: mid, subject };
}
