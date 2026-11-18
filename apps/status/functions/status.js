// The public status feed: current state, uptime and 90-day history per
// component, the last 24 hours of latency, and recent incidents. The page
// reads it, and so can anyone else: GET or POST
//   https://a.gipity.ai/api/<app guid>/fn/status
import { HISTORY_DAYS, buildStatus } from './_lib/status.js';

/** Incidents shown: every open one, plus those resolved in the last 30 days. */
const RESOLVED_INCIDENT_DAYS = 30;

export default async function (ctx, { db }) {
  const now = new Date();

  const recent = await db.query(
    `SELECT component, state, latency_ms, checked_at FROM (
       SELECT component, state, latency_ms, checked_at,
              row_number() OVER (PARTITION BY component ORDER BY checked_at DESC) AS rn
       FROM status_checks WHERE checked_at > now() - interval '1 hour'
     ) latest WHERE rn <= 3 ORDER BY component, checked_at DESC`,
  );

  const last24h = await db.query(
    `SELECT component, count(*)::int AS checks, count(*) FILTER (WHERE state = 'down')::int AS down
     FROM status_checks WHERE checked_at > now() - interval '24 hours' GROUP BY component`,
  );

  // History: the daily rollups, plus raw rows for the days maintain hasn't
  // rolled up yet (always today, and yesterday until the nightly run).
  const rolled = await db.query(
    `SELECT component, day::text AS day, checks, degraded, down FROM status_daily
     WHERE day > (now() AT TIME ZONE 'UTC')::date - $1::int`,
    [HISTORY_DAYS],
  );
  const lastRolled = await db.query('SELECT max(day)::text AS day FROM status_daily');
  const rawSince = lastRolled.rows[0]?.day
    ? new Date(Date.parse(`${lastRolled.rows[0].day}T00:00:00Z`) + 86_400_000)
    : new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
  const raw = await db.query(
    `SELECT component, (checked_at AT TIME ZONE 'UTC')::date::text AS day, count(*)::int AS checks,
            count(*) FILTER (WHERE state = 'degraded')::int AS degraded,
            count(*) FILTER (WHERE state = 'down')::int AS down
     FROM status_checks WHERE checked_at >= $1 GROUP BY 1, 2`,
    [rawSince.toISOString()],
  );

  const spark = await db.query(
    `SELECT component, date_trunc('hour', checked_at) AS hour, round(avg(latency_ms))::int AS ms
     FROM status_checks
     WHERE checked_at > now() - interval '24 hours' AND state <> 'down' AND latency_ms IS NOT NULL
     GROUP BY 1, 2 ORDER BY 2`,
  );

  const incidents = await db.query(
    `SELECT short_guid, title, components, impact, status, started_at, resolved_at
     FROM status_incidents
     WHERE status <> 'resolved' OR resolved_at > now() - make_interval(days => $1::int)
     ORDER BY started_at DESC LIMIT 50`,
    [RESOLVED_INCIDENT_DAYS],
  );
  const guids = incidents.rows.map(i => i.short_guid);
  const updates = guids.length
    ? (await db.query(
      `SELECT incident_guid, status, body, created_at FROM status_incident_updates
       WHERE incident_guid = ANY($1::text[]) ORDER BY created_at DESC`,
      [guids],
    )).rows
    : [];

  return buildStatus({
    now,
    recent: recent.rows,
    last24h: last24h.rows,
    days: [...rolled.rows, ...raw.rows],
    spark: spark.rows,
    incidents: incidents.rows.map(i => ({ ...i, updates: updates.filter(u => u.incident_guid === i.short_guid) })),
  });
}
