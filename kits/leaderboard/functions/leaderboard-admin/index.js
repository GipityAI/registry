// Leaderboard kit - moderation (auth: member, so only the app owner and
// project members can call it). actions: remove | ban | unban | bans | reset |
// submissions. Kit-owned (sealed). Boards themselves are declared in a
// migration, not here.
import { resolvePeriod, clampInt, MAX_PAGE } from '../_lib/leaderboard/core.js';

export default async function leaderboardAdmin(ctx, { db }) {
  const b = ctx.body || {};
  const action = b.action;

  if (action === 'remove') {
    if (!b.entryId) return { error: "'entryId' is required." };
    const { rowCount } = await db.query('DELETE FROM lb_entries WHERE id = $1', [String(b.entryId)]);
    await pruneGhosts(db);
    return { removed: rowCount };
  }

  if (action === 'ban') {
    if (!b.userGuid) return { error: "'userGuid' is required." };
    const userGuid = String(b.userGuid);
    const removed = await db.tx(async (tx) => {
      await tx.query(
        `INSERT INTO lb_bans (user_guid, reason) VALUES ($1, $2)
         ON CONFLICT (user_guid) DO UPDATE SET reason = EXCLUDED.reason`,
        [userGuid, b.reason == null ? null : String(b.reason)],
      );
      const { rowCount } = await tx.query('DELETE FROM lb_entries WHERE user_guid = $1', [userGuid]);
      return rowCount;
    });
    await pruneGhosts(db);
    return { banned: userGuid, removedEntries: removed };
  }

  if (action === 'unban') {
    if (!b.userGuid) return { error: "'userGuid' is required." };
    const { rowCount } = await db.query('DELETE FROM lb_bans WHERE user_guid = $1', [String(b.userGuid)]);
    return { unbanned: rowCount > 0 };
  }

  if (action === 'bans') {
    const { rows } = await db.query('SELECT user_guid, reason, created_at FROM lb_bans ORDER BY created_at DESC LIMIT 500');
    return { bans: rows };
  }

  if (action === 'reset') {
    if (!b.board) return { error: "'board' is required." };
    const params = [String(b.board)];
    let where = 'board = $1';
    if (b.period != null) {
      try { params.push(resolvePeriod(b.period)); } catch (err) { return { error: err.message }; }
      where += ` AND period = $${params.length}`;
    }
    if (b.ruleset != null) { params.push(String(b.ruleset)); where += ` AND ruleset = $${params.length}`; }
    const { rowCount } = await db.query(`DELETE FROM lb_entries WHERE ${where}`, params);
    await pruneGhosts(db);
    return { removed: rowCount };
  }

  if (action === 'submissions') {
    const params = [];
    const where = [];
    if (b.board) { params.push(String(b.board)); where.push(`board = $${params.length}`); }
    if (b.userGuid) { params.push(String(b.userGuid)); where.push(`user_guid = $${params.length}`); }
    if (b.rejectedOnly) where.push('accepted = FALSE');
    const limit = clampInt(b.limit, 50, 1, MAX_PAGE);
    const { rows } = await db.query(
      `SELECT id, board, ruleset, user_guid, score, accepted, reason, game_version, created_at
         FROM lb_submissions ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY created_at DESC LIMIT ${limit}`,
      params,
    );
    return { submissions: rows.map(r => ({ ...r, score: r.score == null ? null : Number(r.score) })) };
  }

  return { error: `Unknown action '${action}'. Use remove, ban, unban, bans, reset or submissions.` };
}

async function pruneGhosts(db) {
  await db.query('DELETE FROM lb_ghosts g WHERE NOT EXISTS (SELECT 1 FROM lb_entries e WHERE e.ghost_id = g.id)');
}
