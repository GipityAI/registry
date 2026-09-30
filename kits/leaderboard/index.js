/**
 * @gipity/leaderboard - browser helpers for the leaderboard kit's functions.
 * Native clients (e.g. the Gipity Godot addon, registry examples/godot) call
 * the same functions over HTTPS: POST /api/<appGuid>/fn/leaderboard-submit | leaderboard-read.
 *
 *   import { submitScore, top, aroundMe, ghost } from '@gipity/leaderboard';
 *   const r = await submitScore('arcade:score', 48200);
 *   const { entries } = await top('arcade:score', { period: 'week' });
 */

const G = () => {
  if (typeof window === 'undefined' || !window.Gipity) {
    throw new Error('@gipity/leaderboard needs the Gipity client SDK. Ensure the gipity.js <script data-app="..."> tag is present.');
  }
  return window.Gipity;
};

const read = (body) => G().fn('leaderboard-read', body);

/** Submit a score for the signed-in player. `tiebreak` is required on boards
 *  that have one; `ghost` (a replay) is base64 bytes. */
export function submitScore(board, score, { tiebreak, ruleset, splits, meta, ghost, gameVersion } = {}) {
  return G().fn('leaderboard-submit', { board, score, tiebreak, ruleset, splits, meta, ghost, gameVersion });
}

/** Top N. `period`: 'all', 'day', 'week', 'month', 'season' (the current one of
 *  each), or a key like '2026-09-28', '2026-W39', '2026-09', 'season:<name>'.
 *  Defaults to all time when the board keeps it. */
export function top(board, { ruleset, period, limit, offset } = {}) {
  return read({ action: 'top', board, ruleset, period, limit, offset });
}

/** The signed-in player's entry and the players ranked around them. */
export function aroundMe(board, { ruleset, period, radius } = {}) {
  return read({ action: 'around', board, ruleset, period, radius });
}

/** The signed-in player's own entry and rank, or `entry: null`. */
export function myEntry(board, { ruleset, period } = {}) {
  return read({ action: 'me', board, ruleset, period });
}

/** Friends' entries (plus yours) by platform ids, e.g. Steam friend ids. */
export function friends(board, ids, { provider = 'steam', ruleset, period } = {}) {
  return read({ action: 'friends', board, ids, provider, ruleset, period });
}

/** An entry's ghost recording as base64, from `entry.hasGhost`. */
export function ghost(entryId) {
  return read({ action: 'ghost', entryId });
}

/** Every configured board and its rules. */
export function boards() {
  return read({ action: 'boards' });
}

/** The running season and recent ones: { current, seasons }. */
export function seasons() {
  return read({ action: 'seasons' });
}
