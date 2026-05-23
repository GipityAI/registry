/**
 * @gipity/realtime - Record adapter (reference, reusable)
 *
 * A generic `entities` adapter for plain-JSON record channels. Works as-is
 * for whiteboard shapes, Kanban cards, agent/task records, desktop windows -
 * any entity that is a JSON-serializable object.
 *
 * Records flow through verbatim; the channel keeps the canonical Map and
 * fires onUpsert/onDelete. The app renders from those callbacks. No engine
 * dependencies.
 *
 *   import { createRecordAdapter } from '@gipity/realtime/adapters/record-adapter.js';
 *   const adapter = createRecordAdapter();            // id field defaults to 'id'
 *   rt.channel('shapes', { sync:'entities', authority:'shared', adapter });
 */

export function createRecordAdapter({ idField = 'id' } = {}) {
  return {
    entities: {
      id: (record) => record[idField],
      encode: (record) => record,   // record -> wire value (identity JSON)
      decode: (value) => value,     // wire value -> record
      apply: () => {},              // app reacts via channel.onUpsert
      remove: () => {},             // app reacts via channel.onDelete
    },
  };
}

export const recordAdapter = createRecordAdapter();
