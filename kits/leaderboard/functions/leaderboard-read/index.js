// Leaderboard kit - read path (auth: public, so boards show before sign-in).
// actions: top | around | me | friends | ghost | boards. Kit-owned (sealed).
// `around` and `me` default to the signed-in caller when one is present.
import { resolvePeriod, orderSql, clampInt, publicEntry, MAX_PAGE, MAX_RADIUS, MAX_FRIEND_IDS } from '../_lib/leaderboard/core.js';

// Ranked view of one board/ruleset/period with banned players filtered out.
// `dir` is whitelisted by orderSql; everything else is a parameter.
const ranked = (dir) => `
  SELECT e.*, RANK() OVER (ORDER BY e.score ${dir}) AS rank,
         ROW_NUMBER() OVER (ORDER BY e.score ${dir}, e.updated_at ASC, e.id) AS pos
    FROM lb_entries e
   WHERE e.board = $1 AND e.ruleset = $2 AND e.period = $3
     AND e.user_guid NOT IN (SELECT user_guid FROM lb_bans)`;

export default async function leaderboardRead(ctx, { db }) {
  const b = ctx.body || {};
  const action = b.action || 'top';

  if (action === 'boards') {
    const { rows } = await db.query('SELECT board, sort, min_score, max_score, splits, rulesets FROM lb_boards ORDER BY board');
    // BIGINT columns arrive as strings; scores are safe integers.
    const num = (v) => (v == null ? null : Number(v));
    return { boards: rows.map(r => ({ ...r, min_score: num(r.min_score), max_score: num(r.max_score) })) };
  }

  if (action === 'ghost') {
    if (!b.entryId) return { error: "'entryId' is required." };
    const { rows: [row] } = await db.query(
      `SELECT e.id, g.data, g.bytes FROM lb_entries e JOIN lb_ghosts g ON g.id = e.ghost_id WHERE e.id = $1`,
      [String(b.entryId)],
    );
    if (!row) return { error: `No ghost for entry '${b.entryId}'.` };
    return { entryId: row.id, ghost: row.data, bytes: row.bytes };
  }

  const boardKey = String(b.board || '');
  if (!boardKey) return { error: "'board' is required." };
  const board = await db.findOne('lb_boards', { board: boardKey });
  if (!board) return { error: `No board '${boardKey}'.` };
  let period;
  try { period = resolvePeriod(b.period); } catch (err) { return { error: err.message }; }
  const ruleset = b.ruleset == null ? '' : String(b.ruleset);
  const dir = orderSql(board.sort);
  const base = [boardKey, ruleset, period];
  const scope = { board: boardKey, ruleset, period };

  if (action === 'top') {
    const limit = clampInt(b.limit, 10, 1, MAX_PAGE);
    const offset = clampInt(b.offset, 0, 0, 1_000_000);
    const { rows } = await db.query(`SELECT * FROM (${ranked(dir)}) r ORDER BY pos LIMIT ${limit} OFFSET ${offset}`, base);
    const { rows: [{ total }] } = await db.query(
      `SELECT COUNT(*)::int AS total FROM lb_entries e
        WHERE e.board = $1 AND e.ruleset = $2 AND e.period = $3
          AND e.user_guid NOT IN (SELECT user_guid FROM lb_bans)`,
      base,
    );
    return { ...scope, entries: rows.map(publicEntry), total };
  }

  if (action === 'me' || action === 'around') {
    const who = b.userGuid ? String(b.userGuid) : ctx.auth?.userGuid;
    if (!who) return { error: 'Sign in, or pass userGuid.' };
    const { rows: [me] } = await db.query(`SELECT * FROM (${ranked(dir)}) r WHERE r.user_guid = $4`, [...base, who]);
    if (action === 'me') return { ...scope, entry: me ? publicEntry(me) : null };
    if (!me) return { ...scope, entry: null, entries: [] };
    const radius = clampInt(b.radius, 5, 0, MAX_RADIUS);
    const { rows } = await db.query(
      `SELECT * FROM (${ranked(dir)}) r WHERE r.pos BETWEEN $4 AND $5 ORDER BY pos`,
      [...base, Number(me.pos) - radius, Number(me.pos) + radius],
    );
    return { ...scope, entry: publicEntry(me), entries: rows.map(publicEntry) };
  }

  if (action === 'friends') {
    // `ids` are platform ids the game already has (e.g. Steam friend ids);
    // entries match on player_ref = '<provider>:<id>'. The caller is included.
    const provider = String(b.provider || 'steam');
    const ids = Array.isArray(b.ids) ? b.ids.slice(0, MAX_FRIEND_IDS).map(id => `${provider}:${id}`) : [];
    const me = ctx.auth?.userGuid || null;
    const { rows } = await db.query(
      `SELECT * FROM (${ranked(dir)}) r WHERE r.player_ref = ANY($4) OR r.user_guid = $5 ORDER BY pos LIMIT ${MAX_PAGE}`,
      [...base, ids, me],
    );
    return { ...scope, entries: rows.map(publicEntry) };
  }

  return { error: `Unknown action '${action}'. Use top, around, me, friends, ghost or boards.` };
}
