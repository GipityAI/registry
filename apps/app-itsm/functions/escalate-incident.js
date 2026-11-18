// escalate-incident.js - Escalate a new P1/P2 incident
// Run by the "P1/P2 Escalation" workflow (auth: member). Notifies the team
// manager, adds a work note, raises the escalation level, and posts to Slack
// when the SLACK_WEBHOOK_URL secret is set.

export default async function escalateIncident(ctx, { db, fetch, secrets }) {
    const { incident_id } = ctx.body;
    const { rows: [incident] } = await db.query(
        `SELECT i.id, i.number, i.priority, i.short_description, i.escalation_level,
                t.name AS team_name, t.manager_user_id
         FROM incidents i
         LEFT JOIN teams t ON t.id = i.team_id
         WHERE i.id = $1`,
        [incident_id]
    );
    if (!incident) return { error: 'Incident not found' };
    if (incident.priority > 2) return { incident_id, skipped: true, reason: 'Not P1/P2' };
    if (incident.escalation_level >= 1) return { incident_id, skipped: true, reason: 'Already escalated' };

    const label = `P${incident.priority} Incident: ${incident.number}`;
    if (incident.manager_user_id) {
        await db.query(
            `INSERT INTO notifications (user_id, title, body, link) VALUES ($1, $2, $3, '/agent/incidents')`,
            [incident.manager_user_id, label, `${incident.short_description} - Requires immediate attention.`]
        );
    }

    await db.query(
        `INSERT INTO comments (target_table, target_id, comment_type, body, author_name, is_ai_generated)
         VALUES ('incidents', $1, 'work_note', $2, 'Workflow: P1 Escalation', true)`,
        [
            incident_id,
            `HIGH PRIORITY ESCALATION: P${incident.priority} incident automatically escalated. `
                + `${incident.manager_user_id ? 'Team lead notified. ' : ''}Assigned team: ${incident.team_name || 'none'}.`,
        ]
    );
    await db.query(
        `UPDATE incidents SET escalation_level = GREATEST(escalation_level, 1), updated_at = NOW() WHERE id = $1`,
        [incident_id]
    );

    let slack = false;
    const webhook = await secrets.get('SLACK_WEBHOOK_URL');
    if (webhook) {
        const res = await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: `:rotating_light: *${label}*\n${incident.short_description}\nTeam: ${incident.team_name || 'none'}`,
            }),
        });
        slack = res.ok;
    }

    return { incident_id, escalated: true, manager_notified: !!incident.manager_user_id, slack };
}
