// Pure scheduling/sequence helpers - no services, fully unit-testable.

// Days between touches for each cadence. null = never auto-send (paused).
export const CADENCE_DAYS = {
    every3: 3,
    weekly: 7,
    biweekly: 14,
    monthly: 30,
    paused: null,
};

export function isValidCadence(cadence) {
    return Object.prototype.hasOwnProperty.call(CADENCE_DAYS, cadence);
}

export function intervalDays(cadence) {
    return isValidCadence(cadence) ? CADENCE_DAYS[cadence] : CADENCE_DAYS.every3;
}

// Re-engagement cadence: pester every FAST_DAYS for the first FAST_TOUCHES touches,
// then back off to BACKOFF_DAYS forever. The sequence never self-terminates - only a
// reply or an unsubscribe stops it (an explicit cadence='paused' also halts sending).
export const FAST_TOUCHES = 3;   // number of fast (3-day) intervals before backing off
export const FAST_DAYS = 3;
export const BACKOFF_DAYS = 30;  // ongoing monthly keep-warm after the fast phase

// Days until the NEXT touch, given the 0-based index of the touch just sent and the
// contact's cadence. Returns null only when the contact is explicitly paused.
export function intervalForStep(sentStep, cadence) {
    if (cadence === 'paused') return null;
    return (Number(sentStep) || 0) < FAST_TOUCHES ? FAST_DAYS : BACKOFF_DAYS;
}

// `from` may be a Date or ISO string; defaults to now.
export function addDays(from, days) {
    const base = from ? new Date(from) : new Date();
    return new Date(base.getTime() + (Number(days) || 0) * 86400000).toISOString();
}

// Next touch time for a contact, as an ISO string (or null if paused).
export function nextContactDate(cadence, from) {
    const days = intervalDays(cadence);
    if (days == null) return null;
    return addDays(from, days);
}

export function clampScore(n) {
    const x = Math.round(Number(n));
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(100, x));
}

// Statuses eligible for scheduled outreach. A reply moves a contact to 'replied',
// which is NOT sendable - replies pause the sequence (the human takes over).
export const SENDABLE_STATUS = ['new', 'in_sequence'];
export function isSendableStatus(status) {
    return SENDABLE_STATUS.includes(status);
}

// Statuses that are in the funnel but never auto-sent to.
export const DORMANT_STATUS = ['to_qualify', 'no_email', 'paused', 'unsubscribed', 'bounced', 'disqualified', 'done'];
export function isDormantStatus(status) {
    return DORMANT_STATUS.includes(status);
}

// Given the number of sequence touches and the index just sent, return the next
// step and whether the sequence is now exhausted (done = no more touches).
export function advanceStep(numSteps, sentStep) {
    const next = (Number(sentStep) || 0) + 1;
    if (numSteps > 0 && next < numSteps) return { seq_step: next, done: false };
    return { seq_step: Math.max(0, numSteps - 1), done: true };
}
