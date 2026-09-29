// Leaderboard kit - pure helpers shared by the submit/read/admin functions.
// No db access here, so every rule is unit-testable directly.

export const MAX_PAGE = 100;
export const MAX_RADIUS = 25;
export const MAX_FRIEND_IDS = 500;
export const MAX_META_CHARS = 2000;
/** Ranking windows a board can keep. 'season' uses the lb_seasons table. */
export const PERIOD_KINDS = ['all', 'day', 'week', 'month', 'season'];

/** ISO-8601 week key for a date, in UTC: '2026-W39'. Weeks start Monday. */
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // the Thursday of this week decides its year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * The stored key for one period kind at `now`, in UTC:
 * all -> 'all', day -> '2026-09-28', week -> '2026-W40', month -> '2026-09',
 * season -> 'season:<name>' (null when no season is running).
 */
export function periodKey(kind, now = new Date(), seasonName = null) {
  const iso = now.toISOString();
  switch (kind) {
    case 'all': return 'all';
    case 'day': return iso.slice(0, 10);
    case 'week': return isoWeek(now);
    case 'month': return iso.slice(0, 7);
    case 'season': return seasonName ? `season:${seasonName}` : null;
    default: throw new Error(`Unknown period kind '${kind}'.`);
  }
}

/** The kind of a stored period key. */
export function periodKind(key) {
  if (key === 'all') return 'all';
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return 'day';
  if (/^\d{4}-W\d{2}$/.test(key)) return 'week';
  if (/^\d{4}-\d{2}$/.test(key)) return 'month';
  if (/^season:.{1,40}$/.test(key)) return 'season';
  return null;
}

/** The periods a board keeps, in PERIOD_KINDS order. */
export function boardPeriods(board) {
  const kinds = Array.isArray(board.periods) && board.periods.length ? board.periods : ['all', 'week'];
  return PERIOD_KINDS.filter(k => kinds.includes(k));
}

/** Every period key a submission made now should count toward. */
export function submissionPeriods(board, now = new Date(), seasonName = null) {
  return boardPeriods(board)
    .map(kind => ({ kind, key: periodKey(kind, now, seasonName) }))
    .filter(p => p.key != null);
}

/**
 * Resolve a requested period to a stored key. Accepts a kind for the current
 * window ('all', 'day', 'week', 'month', 'season') or an explicit key
 * ('2026-09-28', '2026-W39', '2026-09', 'season:Season 1'). Defaults to 'all'
 * when the board keeps it, else to its first period. Throws a readable error
 * for a period the board doesn't keep.
 */
export function resolvePeriod(requested, board, now = new Date(), seasonName = null) {
  const kinds = boardPeriods(board);
  const keeps = `This board keeps: ${kinds.join(', ')}.`;
  const req = requested == null || requested === '' ? (kinds.includes('all') ? 'all' : kinds[0]) : String(requested);
  const kind = PERIOD_KINDS.includes(req) ? req : periodKind(req);
  if (!kind) throw new Error(`Unknown period '${req}'. Use all, day, week, month, season, or a key like '2026-W39', '2026-09-28', '2026-09' or 'season:<name>'.`);
  if (!kinds.includes(kind)) throw new Error(`This board doesn't keep ${kind} rankings. ${keeps}`);
  if (!PERIOD_KINDS.includes(req)) return req;
  const key = periodKey(kind, now, seasonName);
  if (key == null) throw new Error('No season is running. Add one to lb_seasons.');
  return key;
}

/**
 * Is run `a` better than run `b`? Compares scores by the board's sort, then,
 * on boards with a tiebreak, the tiebreak by its own sort. An exact tie is not
 * better, so the earlier run keeps its place.
 */
export function isBetter(board, a, b) {
  const by = (sort, x, y) => (sort === 'desc' ? x > y : x < y);
  if (a.score !== b.score) return by(board.sort, a.score, b.score);
  if (!board.tiebreak_sort || a.tiebreak == null || b.tiebreak == null) return false;
  return by(board.tiebreak_sort, a.tiebreak, b.tiebreak);
}

const dirSql = (sort) => (sort === 'desc' ? 'DESC' : 'ASC');

/** ORDER BY terms for a board's ranking, on columns of table alias `t`.
 *  Whitelisted: only ASC/DESC and fixed column names are ever interpolated. */
export function rankOrderSql(board, t = 'e') {
  const terms = [`${t}.score ${dirSql(board.sort)}`];
  if (board.tiebreak_sort) terms.push(`${t}.tiebreak ${dirSql(board.tiebreak_sort)} NULLS LAST`);
  return terms.join(', ');
}

/** SQL predicate: row `o` ranks strictly ahead of row `e` on this board. */
export function aheadSql(board, o = 'o', e = 'e') {
  const cmp = (sort) => (sort === 'desc' ? '>' : '<');
  const byScore = `${o}.score ${cmp(board.sort)} ${e}.score`;
  if (!board.tiebreak_sort) return `(${byScore})`;
  return `(${byScore} OR (${o}.score = ${e}.score AND ${o}.tiebreak ${cmp(board.tiebreak_sort)} ${e}.tiebreak))`;
}

/** Base64 -> decoded byte length, or null when it isn't valid base64. */
export function base64Bytes(s) {
  if (typeof s !== 'string' || s.length === 0 || s.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return (s.length / 4) * 3 - pad;
}

const VERSION_RE = /^v?(\d{1,9})(?:\.(\d{1,9}))?(?:\.(\d{1,9}))?(?:-([0-9A-Za-z.-]{1,30}))?(?:\+[0-9A-Za-z.-]{1,30})?$/;

/**
 * Parse a game version: major[.minor[.patch]][-prerelease][+build], with an
 * optional leading 'v'. Missing parts are 0 ('1.4' is 1.4.0). Returns null for
 * anything else ('latest', '1.x', '1..2', '').
 */
export function parseVersion(v) {
  if (v == null) return null;
  const m = VERSION_RE.exec(String(v).trim());
  if (!m) return null;
  return { parts: [m[1], m[2], m[3]].map(p => (p == null ? 0 : Number(p))), pre: m[4] ?? null };
}

/**
 * Compare two parsed versions: negative, zero or positive. Semver order: by
 * major, minor, patch; a prerelease sorts before its release (1.2.0-beta <
 * 1.2.0); prereleases compare dot-separated, numbers numerically. Build
 * metadata is ignored.
 */
export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return a.parts[i] - b.parts[i];
  if (a.pre === b.pre) return 0;
  if (a.pre == null) return 1;
  if (b.pre == null) return -1;
  const x = a.pre.split('.');
  const y = b.pre.split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] == null) return -1;
    if (y[i] == null) return 1;
    const nx = /^\d+$/.test(x[i]);
    const ny = /^\d+$/.test(y[i]);
    if (nx && ny && Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]);
    if (nx !== ny) return nx ? -1 : 1;
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

/** A rejected submission: `message` is the reason and `code` a stable
 *  identifier the client can switch on (e.g. GAME_VERSION_TOO_OLD). */
export class SubmissionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Enforce the board's `min_game_version`. A run with no version, a garbage
 * version, or one older than the minimum is refused; the client shows "update
 * your game" on GAME_VERSION_TOO_OLD.
 */
export function checkGameVersion(board, gameVersion) {
  if (board.min_game_version == null) return;
  const min = parseVersion(board.min_game_version);
  if (!min) throw new SubmissionError('BOARD_MISCONFIGURED', `This board's min_game_version '${board.min_game_version}' is not a version like 1.4.2.`);
  if (gameVersion == null || String(gameVersion).trim() === '') {
    throw new SubmissionError('GAME_VERSION_TOO_OLD', `This board needs game version ${board.min_game_version} or newer; send gameVersion with the run.`);
  }
  const v = parseVersion(gameVersion);
  if (!v) throw new SubmissionError('GAME_VERSION_INVALID', `gameVersion '${String(gameVersion).slice(0, 40)}' is not a version like 1.4.2.`);
  if (compareVersions(v, min) < 0) {
    throw new SubmissionError('GAME_VERSION_TOO_OLD', `Game version ${String(gameVersion).slice(0, 40)} is too old for this board; update to ${board.min_game_version} or newer.`);
  }
}

/** Clamp an integer query param. */
export function clampInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

/**
 * Check a submission against its board's rules. Returns a normalized entry, or
 * throws an Error whose message is the rejection reason (logged + returned);
 * version rejections are SubmissionErrors carrying a `code`.
 *
 * The server can't see the game, so these are plausibility checks: a score
 * inside the board's bounds, an allowed ruleset, and (when the board requires
 * splits) checkpoint times that increase and add up to the score. Pair them
 * with bans for anything that gets through.
 */
export function validateSubmission(board, body) {
  const score = Number(body.score);
  if (!Number.isSafeInteger(score)) throw new Error('score must be an integer (points, or a time in ms).');
  if (board.min_score != null && score < Number(board.min_score)) throw new Error(`score ${score} is below this board's minimum (${board.min_score}).`);
  if (board.max_score != null && score > Number(board.max_score)) throw new Error(`score ${score} is above this board's maximum (${board.max_score}).`);

  let tiebreak = null;
  if (board.tiebreak_sort) {
    tiebreak = Number(body.tiebreak);
    if (body.tiebreak == null || !Number.isSafeInteger(tiebreak)) throw new Error('tiebreak must be an integer on this board (it breaks equal scores).');
  } else if (body.tiebreak != null) {
    throw new Error('this board has no tiebreak; leave it out.');
  }

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

  checkGameVersion(board, body.gameVersion);
  const gameVersion = body.gameVersion == null ? null : String(body.gameVersion).slice(0, 40);
  return { score, tiebreak, ruleset, splits, ghost, meta, gameVersion };
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
    tiebreak: r.tiebreak == null ? null : Number(r.tiebreak),
    splits: r.splits,
    meta: r.meta,
    gameVersion: r.game_version,
    hasGhost: r.ghost_id != null,
    updatedAt: r.updated_at,
  };
}
