// Logs a finished lap for the signed-in player (auth: user) and returns their
// totals. Shows a game's own server logic next to the leaderboard kit:
// ctx.auth.identity says whether the player came from Steam or a guest device.
export default async function raceFinish(ctx, { db, guid }) {
  const lapMs = Number(ctx.body.lapMs);
  if (!Number.isSafeInteger(lapMs) || lapMs <= 0) return { error: 'lapMs must be a positive integer (milliseconds).' };
  const provider = ctx.auth.identity?.provider ?? 'gipity';
  await db.query(
    'INSERT INTO laps (id, user_guid, provider, provider_id, lap_ms) VALUES ($1, $2, $3, $4, $5)',
    [guid('lap'), ctx.auth.userGuid, provider, ctx.auth.identity?.id ?? null, lapMs],
  );
  const { rows: [t] } = await db.query(
    'SELECT COUNT(*)::int AS laps, MIN(lap_ms)::int AS best_ms FROM laps WHERE user_guid = $1',
    [ctx.auth.userGuid],
  );
  return { laps: t.laps, bestMs: t.best_ms, signedInWith: provider };
}
