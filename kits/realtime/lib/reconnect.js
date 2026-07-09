/**
 * @gipity/realtime - Reconnection helpers (pure)
 *
 * The reconnection *loop* lives in transport.js - it needs the live Colyseus
 * client. These are the pure decisions that loop makes: how long to wait
 * before the next attempt, and whether a failure is permanent.
 */

/**
 * Exponential backoff delay for reconnect/join attempt `attempt` (1-based).
 * @param {number} attempt           1 = first retry, 2 = second, ...
 * @param {{baseMs?:number, maxMs?:number}} [opts]
 * @returns {number} delay in milliseconds
 */
export function reconnectDelay(attempt, opts = {}) {
  const baseMs = opts.baseMs ?? 800;
  const maxMs = opts.maxMs ?? 8000;
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(baseMs * 2 ** (n - 1), maxMs);
}

/**
 * True when a join/reconnect failure is definitive - retrying the same call
 * cannot succeed - as opposed to a transient network error, which is worth
 * another attempt within the window.
 */
export function isRoomGoneError(err) {
  if (!err) return false;
  if (err.code === 4212) return true; // Colyseus: invalid room id (gone or locked)
  if (err.code === 4211) return true; // Colyseus: no rooms matched (join-only miss)
  return /not found|not available|locked|disposed|reservation/i.test(String(err.message || ''));
}
