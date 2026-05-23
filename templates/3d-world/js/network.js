/**
 * 3D World - Network (realtime facade)
 *
 * Thin engine facade over the @gipity/realtime kit. It builds the 3D
 * adapter (which holds all THREE / Rapier knowledge), creates the channels
 * this game uses, and exposes a small surface to the rest of the engine.
 *
 * Always importable - the underlying connection only opens if
 * config.features.multiplayer is enabled (see features/multiplayer.js).
 * Before connect / in solo mode every channel is a safe no-op.
 */

import * as playerModule from './player.js';
import * as primitives from './primitives.js';
import { createRealtime } from '@gipity/realtime';
import { create3DAdapter } from './network/adapter-3d.js';

// The adapter is the only 3D-aware piece; the primitive itself is engine-free.
const adapter = create3DAdapter({ player: playerModule, primitives });
const rt = createRealtime({});

// Presence channel - the 3D adapter's encode() broadcasts the local avatar
// ({x,y,z,r}) automatically each tick.
const avatars = rt.channel('avatars', { sync: 'presence', adapter: { presence: adapter.presence } });

let world = null;

/** Open the realtime connection. Called by features/multiplayer.js. */
async function initNetwork(config = {}) {
  return rt.connect({
    room: config.room,
    maxClients: config.maxClients,
    apiBase: config.apiBase,
    wsUrl: config.wsUrl,
    settings: config.settings,
  });
}

/**
 * Enable host-authoritative world-state sync (opt-in). The 'world' entities
 * channel runs host election + transform sync internally - the game just
 * has to create it.
 */
function enableWorldSync() {
  if (!world) {
    world = rt.channel('world', {
      sync: 'entities',
      authority: 'host',
      adapter: { entities: adapter.entities, authority: adapter.authority },
    });
  }
  return world;
}

/** Open (or fetch) a channel - used by gameplay features (e.g. rocket-launcher). */
function channel(name, opts) {
  return rt.channel(name, opts);
}

export { rt, initNetwork, enableWorldSync, channel, avatars };
