// Leaderboard kit - submit a score (auth: user). Checks the board's rules,
// logs the attempt, and keeps the player's personal best in every period the
// board ranks (all time, day, week, month, season), each with an optional
// ghost recording. Kit-owned (sealed).
import { validateSubmission, isBetter, submissionPeriods, aheadSql } from '../_lib/leaderboard/core.js';
import { currentSeason } from '../_lib/leaderboard/seasons.js';

export default async function leaderboardSubmit(ctx, { db, guid }) {
  const b = ctx.body || {};
  const { userGuid, displayName, identity } = ctx.auth;
  const boardKey = String(b.board || '');
  if (!boardKey) return { error: "'board' is required." };

  const board = await db.findOne('lb_boards', { board: boardKey });
  if (!board) return { error: `No board '${boardKey}'. Declare boards in a migration (see the leaderboard kit README).` };

  const reject = async (reason, score = null, code = null) => {
    await db.query(
      `INSERT INTO lb_submissions (id, board, ruleset, user_guid, score, accepted, reason, game_version)
       VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7)`,
      [guid('lbs'), boardKey, String(b.ruleset ?? '').slice(0, 64), userGuid, Number.isSafeInteger(Number(score)) ? Number(score) : null,
       reason, b.gameVersion == null ? null : String(b.gameVersion).slice(0, 40)],
    );
    return code ? { accepted: false, code, reason } : { accepted: false, reason };
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
    return reject(err.message, b.score, err.code ?? null);
  }

  const playerRef = identity ? `${identity.provider}:${identity.id}`.slice(0, 80) : null;
  const periods = submissionPeriods(board, new Date(), await currentSeason(db));
  const keys = periods.map(p => p.key);
  if (keys.length === 0) return reject('No season is running, and this board only ranks by season.', run.score);

  const improved = await db.tx(async (tx) => {
    await tx.query(
      `INSERT INTO lb_submissions (id, board, ruleset, user_guid, score, tiebreak, accepted, reason, game_version)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, NULL, $7)`,
      [guid('lbs'), boardKey, run.ruleset, userGuid, run.score, run.tiebreak, run.gameVersion],
    );

    const { rows: current } = await tx.query(
      `SELECT id, period, score, tiebreak, ghost_id FROM lb_entries
        WHERE board = $1 AND ruleset = $2 AND user_guid = $3 AND period = ANY($4)`,
      [boardKey, run.ruleset, userGuid, keys],
    );
    const byPeriod = Object.fromEntries(current.map(r => [r.period, r]));
    const toWrite = keys.filter(k => !byPeriod[k] || isBetter(board, run,
      { score: Number(byPeriod[k].score), tiebreak: byPeriod[k].tiebreak == null ? null : Number(byPeriod[k].tiebreak) }));
    if (toWrite.length === 0) return [];

    let ghostId = null;
    if (run.ghost) {
      ghostId = guid('gho');
      await tx.query('INSERT INTO lb_ghosts (id, data, bytes) VALUES ($1, $2, $3)', [ghostId, run.ghost.data, run.ghost.bytes]);
    }

    for (const period of toWrite) {
      await tx.query(
        `INSERT INTO lb_entries (id, board, ruleset, period, user_guid, player_ref, display_name, score, splits, meta, game_version, ghost_id, tiebreak)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (board, ruleset, period, user_guid) DO UPDATE SET
           player_ref = EXCLUDED.player_ref, display_name = EXCLUDED.display_name, score = EXCLUDED.score, tiebreak = EXCLUDED.tiebreak,
           splits = EXCLUDED.splits, meta = EXCLUDED.meta, game_version = EXCLUDED.game_version,
           ghost_id = EXCLUDED.ghost_id, updated_at = NOW()`,
        [guid('lbe'), boardKey, run.ruleset, period, userGuid, playerRef, (displayName || '').slice(0, 80) || null,
         run.score, run.splits == null ? null : JSON.stringify(run.splits), run.meta, run.gameVersion, ghostId, run.tiebreak],
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

  // Rank and personal best are reported for the board's main period: all time
  // when it keeps one, else its first period.
  const main = periods[0].key;
  const { rows: [mine] } = await db.query(
    `SELECT e.id, e.score, e.tiebreak,
            (SELECT COUNT(*) FROM lb_entries o
              WHERE o.board = e.board AND o.ruleset = e.ruleset AND o.period = e.period AND ${aheadSql(board)}
                AND o.user_guid NOT IN (SELECT user_guid FROM lb_bans))::int + 1 AS rank
       FROM lb_entries e
      WHERE e.board = $1 AND e.ruleset = $2 AND e.period = $3 AND e.user_guid = $4`,
    [boardKey, run.ruleset, main, userGuid],
  );

  return {
    accepted: true,
    score: run.score,
    tiebreak: run.tiebreak,
    improved: Object.fromEntries(periods.map(p => [p.kind, improved.includes(p.key)])),
    period: main,
    personalBest: Number(mine.score),
    rank: mine.rank,
    entryId: mine.id,
  };
}
