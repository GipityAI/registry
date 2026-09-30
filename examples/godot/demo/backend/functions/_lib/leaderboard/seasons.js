// Leaderboard kit - the running season (the latest one whose window contains now).
export async function currentSeason(db) {
  const { rows } = await db.query(
    'SELECT name FROM lb_seasons WHERE starts_at <= NOW() AND ends_at > NOW() ORDER BY starts_at DESC LIMIT 1',
  );
  return rows[0]?.name ?? null;
}
