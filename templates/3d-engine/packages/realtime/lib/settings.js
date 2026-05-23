/**
 * @gipity/realtime - Settings
 * Generic timings + quantization precision. Override via
 * createRealtime({ settings: { ... } }).
 */
export const DEFAULT_SETTINGS = {
  // Host election timing
  pingWaitMs: 2000,
  claimWaitMs: 2000,
  syncTimeoutMs: 5000,
  hostLossMs: 1000,

  // Host-authoritative entity sync.
  // Two timers, either disabled with 0:
  //   keyframeIntervalMs - re-broadcasts EVERY synced entity (the full
  //     reconcile). This is the one rate that matters by default.
  //   syncIntervalMs - an optional finer delta of only entities that moved
  //     since the last send. Disabled by default (one rate is simpler); raise
  //     it above 0 to also touch up fast-moving entities between keyframes.
  syncIntervalMs: 0,
  keyframeIntervalMs: 1000,
  chunkSize: 15,
  deltaMoveThreshold: 0.02,
  // Drift reconciliation (non-host): when a synced entity is off the host by
  // more than driftTolerance (metres) OR a noticeable rotation, the adapter
  // snaps its body onto the host's exact transform + velocity. The visual
  // jump is eased out by the adapter (render-offset decay), so it never pops.
  driftTolerance: 0.015,

  // Quantization precision (host transform sync)
  posPrecision: 0.01,
  rotPrecision: 0.001,

  // Presence
  posRateMs: 50,            // local presence broadcast rate (20 Hz)
  staleTimeoutMs: 2000,     // demote a peer after no presence for this long

  // Connection resilience (transport).
  // On an unclean disconnect the kit retries the Colyseus reconnection token
  // with exponential backoff until reconnectWindowMs elapses. The server holds
  // a dropped seat for 30s, so the window stays under that. Set to 0 to
  // disable reconnection (an unclean drop then behaves like a clean leave).
  reconnectWindowMs: 25000,
  reconnectBaseDelayMs: 800,
  reconnectMaxDelayMs: 8000,
  // Bounded retry around the initial room join - joinOrCreate can lose a
  // seat-reservation race when an instance fills between matchmaking and join.
  joinAttempts: 5,
  // The app token (JWT) is refreshed once it ages past this. Tokens last
  // ~15 min; refreshing early keeps long-lived pages connectable.
  tokenTtlMs: 12 * 60000,
};

let settings = { ...DEFAULT_SETTINGS };

export function getSettings() { return settings; }

export function applySettings(overrides) {
  if (overrides && typeof overrides === 'object') {
    settings = { ...DEFAULT_SETTINGS, ...overrides };
  }
  return settings;
}
