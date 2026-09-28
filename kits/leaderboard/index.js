/**
 * @gipity/leaderboard - browser helpers for the leaderboard kit's functions.
 * Native clients (e.g. the Gipity Godot addon) call the same functions over
 * HTTPS: POST /api/<appGuid>/fn/leaderboard-submit | leaderboard-read.
 *
 *   import { submitScore, top, aroundMe, ghost } from '@gipity/leaderboard';
 *   const r = await submitScore('oval-1:lap', 31250, { splits: [10400, 21010, 31250] });
 *   const { entries } = await top('oval-1:lap', { period: 'week' });
 */

const G = () => {
  if (typeof window === 'undefined' || !window.Gipity) {
    throw new Error('@gipity/leaderboard needs the Gipity client SDK. Ensure the gipity.js <script data-app="..."> tag is present.');
  }
  return window.Gipity;
};

const read = (body) => G().fn('leaderboard-read', body);

/** Submit a score for the signed-in player. `ghost` is base64 bytes. */
export function submitScore(board, score, { ruleset, splits, meta, ghost, gameVersion } = {}) {
  return G().fn('leaderboard-submit', { board, score, ruleset, splits, meta, ghost, gameVersion });
}

/** Top N. `period`: 'all' (default), 'week', or a week key like '2026-W39'. */
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
