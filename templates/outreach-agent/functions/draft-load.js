// Worker: gather everything the draft llm step needs for ONE contact and return it
// as flat, template-friendly fields. The llm step reads these via {{load.result.*}}
// and writes the email from the stored knowledge - no live Gmail call on this path.
//
// The message is shaped by the contact's STAGE in their funnel: the stage carries our
// goal (what we want next) and the ask (the email CTA), and topics hang off the stage.
export default async function draftLoad(ctx, { db }) {
    const id = ctx.body?.contact_guid;
    if (!id) return { error: 'contact_guid required' };
    const contact = await db.findOne('contacts', { short_guid: id });
    if (!contact) return { error: 'Contact not found' };

    const s = (await db.query('SELECT * FROM settings WHERE id=1')).rows[0] || {};
    const facts = (await db.query(
        'SELECT source, content FROM contact_knowledge WHERE contact_guid=$1 ORDER BY created_at ASC', [id])).rows;
    const steps = (await db.query(
        'SELECT step_number, label, instruction FROM sequence_steps ORDER BY step_number')).rows;

    const idx = steps.length ? Math.min(contact.seq_step || 0, steps.length - 1) : 0;
    const step = steps[idx] || { label: 'Intro', instruction: 'Write a warm first touch.' };

    // The stage the recipient is at (its goal + ask drive the email). Falls back to a
    // neutral stage if the contact predates funnels or sits in a deleted stage.
    const stage = contact.stage_guid
        ? (await db.query('SELECT label, goal, ask FROM funnel_stages WHERE short_guid=$1', [contact.stage_guid])).rows[0]
        : null;
    const stageLabel = stage?.label || contact.stage || 'unknown';
    const stageGoal = stage?.goal || 'Move them one step forward with Gipity.';
    const stageAsk = stage?.ask || s.base_ask || 'Invite them to try Gipity and share honest feedback.';

    // Pick the active topic for this stage (most-recently-updated wins). A stage-less
    // topic (stage_guid NULL) is a general one usable anywhere.
    const topic = (await db.query(
        `SELECT title, body FROM topics
          WHERE active = true AND (stage_guid = $1 OR stage_guid IS NULL)
          ORDER BY (stage_guid IS NOT NULL)::int DESC, updated_at DESC
          LIMIT 1`, [contact.stage_guid || null])).rows[0] || null;

    // Prior outbound subjects so a follow-up does not repeat an earlier touch.
    const priorSubjects = (await db.query(
        "SELECT subject FROM messages WHERE contact_guid=$1 AND direction='outbound' AND status='sent' ORDER BY created_at ASC", [id]
    )).rows.map((r) => `- ${r.subject || '(no subject)'}`).join('\n') || '(none yet - this is the first touch)';

    const knowledge = facts.length
        ? facts.map((f) => `- [${f.source}] ${f.content}`).join('\n')
        : '(no knowledge gathered yet - keep the email general and do not invent facts about them)';

    // If they advanced to this stage recently and this is the first touch since, the
    // email should open on the progress (they just deployed / created / signed up),
    // never as if they were dormant.
    const changedMs = contact.stage_changed_at ? Date.now() - new Date(contact.stage_changed_at).getTime() : null;
    const advancedRecently = changedMs != null && changedMs < 14 * 86400000 && (contact.seq_step || 0) === 0;
    const stageNote = advancedRecently
        ? 'They RECENTLY ADVANCED to this stage. Open by acknowledging the progress (what they just did) and build on that momentum - do NOT write as if they are dormant or drifted.'
        : '(no recent stage change - a normal touch)';

    return {
        contact_guid: id,
        name: contact.name || '(unknown)',
        email: contact.email,
        company: contact.company || '(unknown)',
        title: contact.title || '(unknown)',
        notes: contact.notes || '(none)',
        stage_label: stageLabel,
        stage_goal: stageGoal,
        stage_note: stageNote,
        ask: stageAsk,
        topic_title: topic?.title || '(no specific topic - work from the stage ask)',
        topic_body: topic?.body || '(none - personalize from what you know and the stage ask)',
        knowledge,
        prior_subjects: priorSubjects,
        touch_label: step.label,
        touch_number: idx + 1,
        total_touches: steps.length,
        instruction: step.instruction,
        seq_step: idx,
        product_name: s.product_name || 'Gipity',
        product_url: s.product_url || 'https://gipity.ai',
        sender_name: s.sender_name || 'me',
        signature: s.signature || s.sender_name || 'me',
        model: s.model || 'claude-sonnet-4-6',
    };
}
