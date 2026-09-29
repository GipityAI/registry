/**
 * @gipity/realtime - Clock sync
 *
 * NTP-style estimate of the server clock from `__ping`/`__pong` round trips.
 * Each sample gives rtt = now - t and offset = serverTs - (t + rtt / 2); the
 * estimate is the offset of the lowest-RTT sample among the recent ones (the
 * one least distorted by queueing). Pure: the caller supplies the times.
 */

export function createClock({ window = 8 } = {}) {
  const samples = [];   // { rtt, offset }

  function addSample(t, serverTs, now) {
    if (typeof t !== 'number' || typeof serverTs !== 'number' || now < t) return null;
    const rtt = now - t;
    const sample = { rtt, offset: serverTs - (t + rtt / 2) };
    samples.push(sample);
    if (samples.length > window) samples.shift();
    return sample;
  }

  function best() {
    let b = null;
    for (const s of samples) if (!b || s.rtt < b.rtt) b = s;
    return b;
  }

  return {
    addSample,
    /** True once at least one round trip has been measured. */
    isSynced: () => samples.length > 0,
    /** Estimated server clock minus local clock, in ms (0 before any sample). */
    offset: () => best()?.offset ?? 0,
    /** Most recent round trip, in ms (null before any sample). */
    rtt: () => (samples.length ? samples[samples.length - 1].rtt : null),
    /** Lowest recent round trip, in ms (null before any sample). */
    minRtt: () => best()?.rtt ?? null,
    /** Local time converted to server time. */
    toServer: (localMs) => localMs + (best()?.offset ?? 0),
    reset: () => { samples.length = 0; },
  };
}
