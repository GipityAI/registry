// Nightly upkeep (workflows/maintain.yaml): roll each finished UTC day of raw
// checks into status_daily, then delete raw checks older than 90 days. The
// rollup runs first, so a pruned day's history is already kept. `auth: member`.
//
// Re-running is safe: the rollup recomputes from the last rolled day onward
// (upsert), so a late check or a missed night is picked up next time.
import { HISTORY_DAYS } from './_lib/status.js';

export default async function (ctx, { db }) {
  // `now` can be moved forward in a test run only, to exercise the prune.
  const now = ctx.isTest && ctx.body?.now ? new Date(ctx.body.now) : new Date();
  if (Number.isNaN(now.getTime())) return { error: 'now must be an ISO date' };
  const nowIso = now.toISOString();

  const rolled = await db.query(
    `INSERT INTO status_daily (component, day, checks, degraded, down, avg_latency_ms)
     SELECT component, (checked_at AT TIME ZONE 'UTC')::date, count(*)::int,
            count(*) FILTER (WHERE state = 'degraded')::int,
            count(*) FILTER (WHERE state = 'down')::int,
            round(avg(latency_ms) FILTER (WHERE state <> 'down'))::int
     FROM status_checks
     WHERE checked_at < date_trunc('day', $1::timestamptz, 'UTC')
       AND checked_at >= COALESCE(
         (SELECT max(day)::timestamp AT TIME ZONE 'UTC' FROM status_daily),
         '-infinity'::timestamptz)
     GROUP BY 1, 2
     ON CONFLICT (component, day) DO UPDATE SET
       checks = EXCLUDED.checks, degraded = EXCLUDED.degraded,
       down = EXCLUDED.down, avg_latency_ms = EXCLUDED.avg_latency_ms`,
    [nowIso],
  );

  const pruned = await db.query(
    `DELETE FROM status_checks WHERE checked_at < $1::timestamptz - make_interval(days => $2::int)`,
    [nowIso, HISTORY_DAYS],
  );

  return { rolled_up: rolled.rowCount ?? 0, pruned: pruned.rowCount ?? 0 };
}
