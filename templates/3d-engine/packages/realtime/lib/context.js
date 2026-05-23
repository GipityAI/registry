/**
 * @gipity/realtime - Adapter context
 *
 * Adapters are capability-sectioned: { presence, entities, authority }. An
 * app supplies only the sections its channels use. normalizeAdapter() fills
 * missing methods with safe no-ops so channel code never branches on
 * "is this method present".
 *
 * The full contract lives in ../contracts/adapter.contract.md.
 */

export const NOOP_PRESENCE = {
  encode: () => null,             // local state -> wire payload (null = skip)
  apply: () => {},                // (peerRecord, payload) -> void
  newPeer: () => ({}),            // -> blank peer record
};

export const NOOP_ENTITIES = {
  id: (e) => e && e.id,
  encode: (record) => record,     // record -> jsonable wire value
  decode: (value) => value,       // jsonable wire value -> record
  apply: () => {},                // (id, record, prev) -> void
  remove: () => {},               // (id) -> void
  list: () => [],                 // -> iterable of entities (host mode)
  get: () => null,                // (id) -> entity | null (host mode)
  clearAll: () => {},             // host mode
  serializeFullRow: (e) => [e && e.id],
  applyFullRow: () => {},
  getDriftAnchor: () => null,     // (entity) -> {x,y,z} | null
  serializeDeltaRow: (e) => [e && e.id],
  applyDeltaRow: () => 0,         // (row) -> drift number
};

export const NOOP_AUTHORITY = {
  hasData: () => false,
  onBecomeHost: () => {},
  onResign: () => {},
};

export function normalizeAdapter(adapter = {}) {
  const rawEntities = adapter.entities || {};
  return {
    presence: { ...NOOP_PRESENCE, ...(adapter.presence || {}) },
    entities: {
      ...NOOP_ENTITIES,
      ...rawEntities,
      // True only when the app actually supplied getDriftAnchor. The host
      // sync uses it to choose physics-style delta + drift correction (true)
      // vs. syncing every row each keyframe (false - for non-spatial host
      // state, e.g. a turn/real-time game with no {x,y,z}).
      tracksDrift: typeof rawEntities.getDriftAnchor === 'function',
    },
    authority: { ...NOOP_AUTHORITY, ...(adapter.authority || {}) },
  };
}
