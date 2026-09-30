// Leaderboard kit - erase one player's leaderboard data: their entries (which
// carry their display name), their submission log, any ban on them, and the
// ghosts only their entries used. Idempotent: purging twice is a no-op.
export async function purgePlayer(db, userGuid) {
  return db.tx(async (tx) => {
    const { rows: ghosts } = await tx.query(
      'SELECT DISTINCT ghost_id FROM lb_entries WHERE user_guid = $1 AND ghost_id IS NOT NULL',
      [userGuid],
    );
    const entries = await tx.query('DELETE FROM lb_entries WHERE user_guid = $1', [userGuid]);
    const submissions = await tx.query('DELETE FROM lb_submissions WHERE user_guid = $1', [userGuid]);
    const bans = await tx.query('DELETE FROM lb_bans WHERE user_guid = $1', [userGuid]);
    let ghostCount = 0;
    if (ghosts.length) {
      const pruned = await tx.query(
        `DELETE FROM lb_ghosts g WHERE g.id = ANY($1)
           AND NOT EXISTS (SELECT 1 FROM lb_entries e WHERE e.ghost_id = g.id)`,
        [ghosts.map(r => r.ghost_id)],
      );
      ghostCount = pruned.rowCount;
    }
    return { entries: entries.rowCount, submissions: submissions.rowCount, bans: bans.rowCount, ghosts: ghostCount };
  });
}
