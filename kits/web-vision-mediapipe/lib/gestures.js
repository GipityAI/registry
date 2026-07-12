/**
 * Reading gestures out of a frame.
 *
 * The gesture task's raw result is a MediaPipe shape - `result.gestures` is an
 * array *per hand* of ranked categories, and an unrecognised pose is reported
 * as the category "None", not as an empty list. Every gesture app has to (a)
 * dig the label out of that and (b) stop it flickering: the model re-classifies
 * ~30x a second and mid-throw hands pass through several labels, so acting on
 * the raw per-frame label makes an app that fires on noise.
 *
 * Both of those live here, so an app never re-implements them.
 */

/**
 * The gestures the default model recognises. Anything else it sees is 'None'.
 * Handy mapping for a game: rock = Closed_Fist, paper = Open_Palm,
 * scissors = Victory.
 */
export const GESTURES = [
  'Closed_Fist',
  'Open_Palm',
  'Pointing_Up',
  'Thumb_Up',
  'Thumb_Down',
  'Victory',
  'ILoveYou',
];

/**
 * The gesture a hand is making in one frame, or null if there isn't a
 * confident one ('None' - the model's "no idea" label - counts as null).
 * @param {Object} result  A frame result from the gesture task.
 * @param {Object} [opts]
 * @param {number} [opts.hand=0]      Which hand, in the model's ranking.
 * @param {number} [opts.minScore=0.5] Confidence floor.
 * @returns {string|null} e.g. 'Victory'
 */
export function gestureName(result, { hand = 0, minScore = 0.5 } = {}) {
  const top = result?.gestures?.[hand]?.[0];
  if (!top || top.categoryName === 'None') return null;
  return top.score >= minScore ? top.categoryName : null;
}

/**
 * A gesture "commit" gate: turns the jittery per-frame label into a settled
 * one. Feed it every frame and read it either way round:
 *
 *   PUSH - one event per deliberate gesture. `read` returns the name on the
 *   single frame the pose settles, and won't fire again until the hand changes
 *   (so a held pose is one throw, not sixty). `mountVision`'s `onGesture` is
 *   exactly this, pre-wired.
 *
 *   PULL - `stable()` is whatever the hand is *currently* holding, once it has
 *   held it for `holdMs`. This is what a round-based game wants: run a "3, 2,
 *   1, shoot!" countdown, then sample it at shoot. `mountVision().gesture()`
 *   is exactly this.
 *
 * Use the pull side for anything on a clock. Caching the last pushed event in
 * a variable looks equivalent and isn't: the push side deliberately won't
 * re-fire for an unchanged hand, so a player who throws rock two rounds in a
 * row would score the second round off a stale event.
 *
 * @param {Object} [opts]
 * @param {number} [opts.holdMs=500]   How long the pose must be steady to count.
 * @param {number} [opts.minScore=0.5] Confidence floor.
 * @param {number} [opts.hand=0]       Which hand to watch.
 * @returns {{read:Function, stable:Function, holding:Function, committed:Function, reset:Function}}
 */
export function createGestureGate({ holdMs = 500, minScore = 0.5, hand = 0 } = {}) {
  let candidate = null;   // what the hand is showing right now
  let since = 0;          // when it started showing it
  let settled = null;     // candidate, once it has been held for holdMs
  let committed = null;   // what we last fired for; cleared when the hand changes

  return {
    /**
     * Feed one frame. Returns the gesture name on the single frame it commits,
     * and null on every other frame - so `if (gate.read(r))` is the whole app.
     * @param {Object} result  Frame result from the gesture task.
     * @param {number} [nowMs] Clock override (tests); defaults to performance.now().
     */
    read(result, nowMs = performance.now()) {
      const name = gestureName(result, { hand, minScore });
      if (name !== candidate) {
        candidate = name;
        since = nowMs;
        settled = null;
        committed = null;   // a new pose is a new throw
      }
      if (candidate && nowMs - since >= holdMs) settled = candidate;
      if (settled && committed !== settled) {
        committed = settled;
        return committed;
      }
      return null;
    },
    /**
     * The gesture the hand is holding *right now*, having held it steadily for
     * `holdMs` - null if the hand is empty, moving, or mid-change. Poll this on
     * your own clock (e.g. when a countdown hits zero).
     */
    stable: () => settled,
    /** What the hand is showing right now, held long enough or not (may be null). */
    holding: () => candidate,
    /** The last gesture that committed, until the hand changes. */
    committed: () => committed,
    /** Forget everything - e.g. between rounds, or after switching tasks. */
    reset() { candidate = null; since = 0; settled = null; committed = null; },
  };
}
