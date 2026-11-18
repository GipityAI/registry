// Post an incident or an update to one (owner only: `auth: member`).
//
// New incident:  { title, components?: ['api', ...], impact?: 'minor'|'major',
//                  status?: 'investigating', body }
// Update:        { incident: '<id>', status: 'identified'|'monitoring'|'resolved'|..., body }
//
// From the terminal:
//   gipity fn call incident-post '{"title":"Slow deploys","components":["api"],"body":"Looking into it."}'
//   gipity fn call incident-post '{"incident":"inc_...","status":"resolved","body":"Fixed."}'
import { parseIncidentInput } from './_lib/status.js';

export default async function (ctx, { db, guid }) {
  const input = parseIncidentInput(ctx.body);
  if (input.error) return { error: input.error };

  return db.tx(async (tx) => {
    let incidentGuid = input.incident;
    if (incidentGuid) {
      const { rows } = await tx.query(
        `UPDATE status_incidents
         SET status = $2::text, updated_at = now(),
             resolved_at = CASE WHEN $2::text = 'resolved' THEN COALESCE(resolved_at, now()) ELSE NULL END
         WHERE short_guid = $1 RETURNING short_guid`,
        [incidentGuid, input.status],
      );
      if (!rows.length) return { error: 'incident not found' };
    } else {
      incidentGuid = guid('inc');
      await tx.query(
        `INSERT INTO status_incidents (short_guid, title, components, impact, status, resolved_at)
         VALUES ($1, $2, $3::text[], $4, $5::text, CASE WHEN $5::text = 'resolved' THEN now() END)`,
        [incidentGuid, input.title, input.components, input.impact, input.status],
      );
    }
    await tx.query(
      'INSERT INTO status_incident_updates (short_guid, incident_guid, status, body) VALUES ($1, $2, $3, $4)',
      [guid('upd'), incidentGuid, input.status, input.body],
    );
    return { ok: true, incident: incidentGuid, status: input.status };
  });
}
