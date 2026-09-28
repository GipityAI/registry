// Leaderboard kit - submit a score (auth: user). Checks the board's rules,
// logs the attempt, and keeps the player's personal best for all time and for
// this ISO week, each with an optional ghost recording. Kit-owned (sealed).
import { validateSubmission, isBetter, isoWeek, orderSql } from '../_lib/leaderboard/core.js';

export default async function leaderboardSubmit(ctx, { db, guid }) {
  const b = ctx.body || {};
  const { userGuid, displayName, identity } = ctx.auth;
  const boardKey = String(b.board || '');
  if (!boardKey) return { error: "'board' is required." };

  const board = await db.findOne('lb_boards', { board: boardKey });
  if (!board) return { error: `No board '${boardKey}'. Declare boards in a migration (see the leaderboard kit README).` };

  const reject = async (reason, score = null) => {
    await db.query(
      `INSERT INTO lb_submissions (id, board, ruleset, user_guid, score, accepted, reason, game_version)
       VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7)`,
      [guid('lbs'), boardKey, String(b.ruleset ?? '').slice(0, 64), userGuid, Number.isSafeInteger(Number(score)) ? Number(score) : null,
       reason, b.gameVersion == null ? null : String(b.gameVersion).slice(0, 40)],
    );
    return { accepted: false, reason };
  };

  const banned = await db.findOne('lb_bans', { user_guid: userGuid });
  if (banned) return { accepted: false, reason: 'This player is banned from the leaderboards.' };

  const { rows: [{ recent }] } = await db.query(
    `SELECT COUNT(*)::int AS recent FROM lb_submissions
      WHERE user_guid = $1 AND board = $2 AND created_at > NOW() - INTERVAL '1 hour'`,
    [userGuid, boardKey],
  );
  if (recent >= board.submit_per_hour) return { accepted: false, reason: `Rate limit: ${board.submit_per_hour} submissions per hour on this board.` };

  let run;
  try {
    run = validateSubmission(board, b);
  } catch (err) {
    return reject(err.message, b.score);
  }

  const playerRef = identity ? `${identity.provider}:${identity.id}`.slice(0, 80) : null;
  const periods = ['all', isoWeek()];

  const improved = await db.tx(async (tx) => {
    await tx.query(
      `INSERT INTO lb_submissions (id, board, ruleset, user_guid, score, accepted, reason, game_version)
       VALUES ($1, $2, $3, $4, $5, TRUE, NULL, $6)`,
      [guid('lbs'), boardKey, run.ruleset, userGuid, run.score, run.gameVersion],
    );

    const { rows: current } = await tx.query(
      `SELECT id, period, score, ghost_id FROM lb_entries
        WHERE board = $1 AND ruleset = $2 AND user_guid = $3 AND period = ANY($4)`,
      [boardKey, run.ruleset, userGuid, periods],
    );
    const byPeriod = Object.fromEntries(current.map(r => [r.period, r]));
    const toWrite = periods.filter(p => !byPeriod[p] || isBetter(board.sort, run.score, Number(byPeriod[p].score)));
    if (toWrite.length === 0) return [];

    let ghostId = null;
    if (run.ghost) {
      ghostId = guid('gho');
      await tx.query('INSERT INTO lb_ghosts (id, data, bytes) VALUES ($1, $2, $3)', [ghostId, run.ghost.data, run.ghost.bytes]);
    }

    for (const period of toWrite) {
      await tx.query(
        `INSERT INTO lb_entries (id, board, ruleset, period, user_guid, player_ref, display_name, score, splits, meta, game_version, ghost_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (board, ruleset, period, user_guid) DO UPDATE SET
           player_ref = EXCLUDED.player_ref, display_name = EXCLUDED.display_name, score = EXCLUDED.score,
           splits = EXCLUDED.splits, meta = EXCLUDED.meta, game_version = EXCLUDED.game_version,
           ghost_id = EXCLUDED.ghost_id, updated_at = NOW()`,
        [guid('lbe'), boardKey, run.ruleset, period, userGuid, playerRef, (displayName || '').slice(0, 80) || null,
         run.score, run.splits == null ? null : JSON.stringify(run.splits), run.meta, run.gameVersion, ghostId],
      );
    }

    // Drop ghosts nothing points at any more (the runs these just replaced).
    const replaced = toWrite.map(p => byPeriod[p]?.ghost_id).filter(Boolean);
    if (replaced.length) {
      await tx.query(
        `DELETE FROM lb_ghosts g WHERE g.id = ANY($1)
           AND NOT EXISTS (SELECT 1 FROM lb_entries e WHERE e.ghost_id = g.id)`,
        [replaced],
      );
    }
    return toWrite;
  });

  const dir = orderSql(board.sort);
  const cmp = dir === 'ASC' ? '<' : '>';
  const { rows: [mine] } = await db.query(
    `SELECT e.id, e.score,
            (SELECT COUNT(*) FROM lb_entries o
              WHERE o.board = e.board AND o.ruleset = e.ruleset AND o.period = 'all' AND o.score ${cmp} e.score
                AND o.user_guid NOT IN (SELECT user_guid FROM lb_bans))::int + 1 AS rank
       FROM lb_entries e
      WHERE e.board = $1 AND e.ruleset = $2 AND e.period = 'all' AND e.user_guid = $3`,
    [boardKey, run.ruleset, userGuid],
  );

  return {
    accepted: true,
    score: run.score,
    improved: { allTime: improved.includes('all'), week: improved.includes(periods[1]) },
    personalBest: Number(mine.score),
    rank: mine.rank,
    entryId: mine.id,
  };
}
