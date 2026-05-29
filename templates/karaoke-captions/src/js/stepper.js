/**
 * Stepper state machine for the wizard. Pure-data layer: given a song's
 * progress (does it have an alignment? at least one render?) plus the
 * currently-active step, decide which of the 4 buttons render as
 * locked / available / complete / active.
 *
 * Forward gates are data-driven (you can't enter Edit without an alignment
 * and you can't enter Style or Export without one either). Backwards is
 * always allowed.
 *
 * Pure functions only — DOM wiring lives in main.js so the stepper logic
 * can be unit-tested without a browser. The renderer in main.js takes the
 * computeStepperStates() output and toggles classes / disabled flags.
 */

export const STEP_KEYS = ['upload', 'edit', 'style', 'export'];

/**
 * @param {Object} song - shape: { alignment_json?: any, renders?: any[] }.
 *                        Null/undefined = no song selected yet.
 * @returns {Set<string>} - step keys that are unlocked.
 */
export function unlockedSteps(song) {
  const out = new Set(['upload']);   // always reachable
  if (song && song.alignment_json) {
    out.add('edit');
    out.add('style');
    out.add('export');               // export visible even before first render
  }
  return out;
}

/**
 * @param {Object} song
 * @param {string} activeStep - which step is currently being viewed
 * @returns {Record<string, 'active'|'complete'|'available'|'locked'>}
 */
export function computeStepperStates(song, activeStep) {
  const unlocked = unlockedSteps(song);
  const hasAlignment = !!(song && song.alignment_json);
  const hasRender = !!(song && Array.isArray(song.renders) && song.renders.some(r => r && r.video_url));
  const out = {};
  for (const k of STEP_KEYS) {
    if (k === activeStep) {
      out[k] = 'active';
    } else if (!unlocked.has(k)) {
      out[k] = 'locked';
    } else if (k === 'upload' && hasAlignment) {
      out[k] = 'complete';
    } else if (k === 'edit' && hasAlignment) {
      // Edit is "complete" only if user has moved past it (has saved or rendered)
      // — but for v1 we use hasAlignment as the proxy. Refine later if needed.
      out[k] = hasRender ? 'complete' : 'available';
    } else if (k === 'style' && hasRender) {
      out[k] = 'complete';
    } else {
      out[k] = 'available';
    }
  }
  return out;
}

/**
 * After step `from` finishes, where should the wizard auto-advance to?
 * Returns null when no auto-advance is wanted (caller should stay put).
 *
 *   upload  → alignment completes → edit
 *   edit    → user clicks "Continue to style →"  → style       (manual)
 *   style   → render completes → export
 *   export  → user clicks "Back to style" → style              (manual)
 */
export function nextStepAfter(from) {
  if (from === 'upload') return 'edit';
  if (from === 'style')  return 'export';
  return null;
}

/** Can the user click on `target` step right now? */
export function canEnter(song, target) {
  return unlockedSteps(song).has(target);
}
