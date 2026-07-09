/**
 * @gipity/realtime - Typed join failures (pure)
 *
 * A failed join used to surface as a silent `null` room and a console.warn,
 * which every app then rendered as a UI stuck on "Joining…". Multi-room opens
 * (rt.join / create / joinById / joinExisting and everything built on them)
 * now throw a RealtimeJoinError whose `code` an app can switch on to show the
 * right message: "table is full", "that game is gone", "bad invite code".
 */

/** @typedef {'offline'|'auth'|'full'|'gone'|'not-found'|'failed'} JoinErrorCode */

export class RealtimeJoinError extends Error {
  /**
   * @param {JoinErrorCode} code
   * @param {string} message
   * @param {Error} [cause]
   */
  constructor(code, message, cause) {
    super(message);
    this.name = 'RealtimeJoinError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/**
 * Map a raw join failure to a JoinErrorCode. Colyseus signals matchmaking
 * failures with err.code 4211/4212 and distinguishing message text:
 *   4212 "room X is locked"      -> the instance is at max_clients -> 'full'
 *   4212 "room X not found"      -> the instance is gone            -> 'gone'
 *   4211 "no rooms found ..."    -> join-only found nothing         -> 'not-found'
 * Token/auth problems and everything else fall through to 'auth' / 'failed'.
 * @param {Error|null|undefined} err  null/undefined = no app GUID (offline mode)
 * @returns {JoinErrorCode}
 */
export function classifyJoinError(err) {
  if (!err) return 'offline';
  const msg = String(err.message || '');
  if (err.code === 4212 || /reservation/i.test(msg)) {
    if (/locked/i.test(msg)) return 'full';
    return 'gone';
  }
  if (err.code === 4211 || /no rooms found/i.test(msg)) return 'not-found';
  if (/locked|max ?clients|is full/i.test(msg)) return 'full';
  if (/disposed|not found|not available/i.test(msg)) return 'gone';
  if (/token|auth/i.test(msg)) return 'auth';
  return 'failed';
}

/** Wrap a raw failure in a RealtimeJoinError (idempotent). */
export function toJoinError(err, context = 'join failed') {
  if (err instanceof RealtimeJoinError) return err;
  const code = classifyJoinError(err);
  const detail = err?.message ? `: ${err.message}` : code === 'offline' ? ' (no app GUID - offline)' : '';
  return new RealtimeJoinError(code, `${context}${detail}`, err || undefined);
}
