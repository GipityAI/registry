/**
 * @gipity/realtime - Observability
 *
 * Makes the runtime inspectable rather than a black box: lifecycle events
 * + counters an app (or a dashboard) can read. See README "Observability".
 */

export function createObservability() {
  const listeners = new Map(); // event -> Set<cb>
  const counters = {
    messagesSent: 0,
    messagesReceived: 0,
    dataWrites: 0,
    dataDeletes: 0,
    syncFull: 0,
    syncDelta: 0,
    lastMaxDrift: 0,
  };

  function on(event, cb) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(cb);
    return () => listeners.get(event)?.delete(cb);
  }

  function emit(event, data) {
    const s = listeners.get(event);
    if (s) for (const cb of s) {
      try { cb(data); } catch (e) { console.warn('[realtime] observer error', e); }
    }
  }

  function bump(counter, by = 1) {
    if (counter in counters) counters[counter] += by;
  }

  function set(counter, value) {
    if (counter in counters) counters[counter] = value;
  }

  function snapshot() {
    return { ...counters };
  }

  return { on, emit, bump, set, snapshot };
}
