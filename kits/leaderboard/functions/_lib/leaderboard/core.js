// Leaderboard kit - pure helpers shared by the submit/read/admin functions.
// No db access here, so every rule is unit-testable directly.

export const MAX_PAGE = 100;
export const MAX_RADIUS = 25;
export const MAX_FRIEND_IDS = 500;
export const MAX_META_CHARS = 2000;

/** ISO-8601 week key for a date, in UTC: '2026-W39'. Weeks start Monday. */
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // the Thursday of this week decides its year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Resolve a requested period: 'all' (default), 'week' (this ISO week), or an explicit week key. */
export function resolvePeriod(period, now = new Date()) {
  if (period == null || period === '' || period === 'all') return 'all';
  if (period === 'week') return isoWeek(now);
  if (/^\d{4}-W\d{2}$/.test(period)) return period;
  throw new Error(`Unknown period '${period}'. Use 'all', 'week', or a week key like '2026-W39'.`);
}

/** Is `a` a better score than `b` on a board with this sort? */
export function isBetter(sort, a, b) {
  return sort === 'desc' ? a > b : a < b;
}

/** SQL order keyword for a board sort. Whitelisted: never interpolate anything else. */
export function orderSql(sort) {
  return sort === 'desc' ? 'DESC' : 'ASC';
}

/** Base64 -> decoded byte length, or null when it isn't valid base64. */
export function base64Bytes(s) {
  if (typeof s !== 'string' || s.length === 0 || s.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return (s.length / 4) * 3 - pad;
}

/** Clamp an integer query param. */
export function clampInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

/**
 * Check a submission against its board's rules. Returns a normalized entry, or
 * throws an Error whose message is the rejection reason (logged + returned).
 *
 * The server can't see the game, so these are plausibility checks: a score
 * inside the board's bounds, an allowed ruleset, and (when the board requires
 * splits) checkpoint times that increase and add up to the score. Pair them
 * with bans for anything that gets through.
 */
export function validateSubmission(board, body) {
  const score = Number(body.score);
  if (!Number.isSafeInteger(score)) throw new Error('score must be an integer (e.g. a time in ms).');
  if (board.min_score != null && score < Number(board.min_score)) throw new Error(`score ${score} is below this board's minimum (${board.min_score}).`);
  if (board.max_score != null && score > Number(board.max_score)) throw new Error(`score ${score} is above this board's maximum (${board.max_score}).`);

  const ruleset = body.ruleset == null ? '' : String(body.ruleset);
  if (ruleset.length > 64) throw new Error('ruleset must be 64 characters or fewer.');
  if (Array.isArray(board.rulesets) && !board.rulesets.includes(ruleset)) {
    throw new Error(`ruleset '${ruleset}' is not an official ruleset for this board.`);
  }

  let splits = null;
  if (board.splits != null || body.splits != null) {
    splits = body.splits;
    if (!Array.isArray(splits) || !splits.every(Number.isSafeInteger)) throw new Error('splits must be an array of integers (cumulative checkpoint times).');
    if (board.splits != null && splits.length !== Number(board.splits)) throw new Error(`expected ${board.splits} splits, got ${splits.length}.`);
    for (let i = 1; i < splits.length; i++) {
      if (splits[i] <= splits[i - 1]) throw new Error(`splits must increase (split ${i + 1} is not after split ${i}).`);
    }
    if (splits.length > 0 && splits[0] <= 0) throw new Error('splits must be positive.');
    if (splits.length > 0 && splits[splits.length - 1] !== score) throw new Error('the last split must equal the score.');
  }

  let ghost = null;
  if (body.ghost != null) {
    const bytes = base64Bytes(body.ghost);
    if (bytes == null) throw new Error('ghost must be base64-encoded bytes.');
    if (bytes > board.max_ghost_bytes) throw new Error(`ghost is ${bytes} bytes; this board allows ${board.max_ghost_bytes}.`);
    ghost = { data: body.ghost, bytes };
  }

  let meta = null;
  if (body.meta != null) {
    if (typeof body.meta !== 'object' || Array.isArray(body.meta)) throw new Error('meta must be an object.');
    if (JSON.stringify(body.meta).length > MAX_META_CHARS) throw new Error(`meta must be under ${MAX_META_CHARS} characters of JSON.`);
    meta = body.meta;
  }

  const gameVersion = body.gameVersion == null ? null : String(body.gameVersion).slice(0, 40);
  return { score, ruleset, splits, ghost, meta, gameVersion };
}

/** Public shape of an entry row. */
export function publicEntry(r) {
  return {
    rank: r.rank == null ? null : Number(r.rank),
    entryId: r.id,
    userGuid: r.user_guid,
    playerRef: r.player_ref,
    displayName: r.display_name,
    score: Number(r.score),
    splits: r.splits,
    meta: r.meta,
    gameVersion: r.game_version,
    hasGhost: r.ghost_id != null,
    updatedAt: r.updated_at,
  };
}
