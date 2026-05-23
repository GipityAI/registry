/**
 * Example: multiplayer strategy / city-builder.
 *
 * The performance shape: host authority + high-frequency transform delta
 * sync + chunking. One peer is elected host and owns the simulation; others
 * apply its full/delta syncs with drift correction.
 *
 * The entities adapter here is an illustrative in-memory sketch. A real 3D
 * game backs serializeFullRow/applyDeltaRow with physics bodies - see the
 * 3D-world app's src/js/network/adapter-3d.js for the production version.
 */

import { createRealtime } from '@gipity/realtime';
import { quantize, getSettings } from '@gipity/realtime';

const buildings = new Map(); // id -> { id, x, y, z, owner, hp }

const buildingAdapter = {
  authority: {
    hasData: () => buildings.size > 0,
    onBecomeHost: () => console.log('[city] now hosting the simulation'),
    onResign: () => console.log('[city] no longer host'),
  },
  entities: {
    id: (b) => b.id,
    list: () => buildings.values(),
    get: (id) => buildings.get(id) || null,
    clearAll: () => buildings.clear(),
    serializeFullRow: (b) => {
      const p = getSettings().posPrecision;
      return [b.id, quantize(b.x, p), quantize(b.y, p), quantize(b.z, p), b.owner, b.hp];
    },
    applyFullRow: (row) => {
      const [id, x, y, z, owner, hp] = row;
      buildings.set(id, { id, x, y, z, owner, hp });
    },
    getDriftAnchor: (b) => ({ x: b.x, y: b.y, z: b.z }),
    serializeDeltaRow: (b) => {
      const p = getSettings().posPrecision;
      return [b.id, quantize(b.x, p), quantize(b.y, p), quantize(b.z, p)];
    },
    applyDeltaRow: (row) => {
      const [id, x, y, z] = row;
      const b = buildings.get(id);
      if (!b) return 0;
      const drift = Math.hypot(b.x - x, b.y - y, b.z - z);
      b.x = x; b.y = y; b.z = z;
      return drift;
    },
    // CRUD (create/destroy, hp/owner changes) ride the entity-op relay:
    apply: (id, rec) => buildings.set(id, rec),
    remove: (id) => buildings.delete(id),
  },
};

export async function startCity({ render }) {
  const rt = createRealtime({ room: 'empire-1', settings: { syncIntervalMs: 1000 } });

  const world = rt.channel('buildings', { sync: 'entities', authority: 'host', adapter: buildingAdapter });
  rt.channel('players', { sync: 'presence' });

  world.onUpsert((id) => render(id, buildings.get(id)));
  world.onDelete((id) => render(id, null));

  await rt.connect();   // triggers host election inside the 'buildings' channel

  return {
    place: (b) => world.upsert(b.id, b),
    destroy: (id) => world.delete(id),
    isHost: () => world.isHost(),
    rt,
  };
}
