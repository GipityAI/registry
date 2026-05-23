/**
 * @gipity/realtime
 *
 * An engine-agnostic realtime kit for Gipity apps: Colyseus transport,
 * channels (messages / presence / entities), host election, server-persisted
 * entity sync, and observability. NO 3D / physics / rendering dependencies.
 *
 * Single-room app - declare channels, then connect:
 *
 *   import { createRealtime } from '@gipity/realtime';
 *   const rt = createRealtime({ room: 'lobby' });
 *   const chat = rt.channel('chat', { sync: 'messages' });
 *   await rt.connect();
 *   chat.send('msg', { text: 'hello' });
 *
 * Multi-room app (a lobby plus many match rooms) - one client, many rooms:
 *
 *   const rt = createRealtime();
 *   const lobby = await rt.join('lobby');        // shared directory room
 *   const match = await rt.create('match');      // a fresh match instance
 *   const other = await rt.joinById(id, 'match');// an advertised instance
 *
 * Every room handle has the same surface (channel / connect / peers / on).
 * One Colyseus client and one app token are shared across them all.
 *
 * See examples/ for one worked file per app shape.
 */

import { createClient } from './lib/client.js';
import { createTransport } from './lib/transport.js';
import { createObservability } from './lib/observability.js';
import { createChannelRegistry } from './lib/channels.js';
import { createDirectory } from './lib/directory.js';
import { applySettings, getSettings } from './lib/settings.js';
import {
  quantize, quantizeVec3, quantizeQuat,
  evaluateHost, chunkInit, assembleChunks, computeDrift,
} from './lib/protocol.js';

/**
 * Build one room handle - a transport, a channel registry, and observability.
 * `baseConfig` is merged under every connect() call (so a room name passed to
 * createRealtime is honoured even when connect() is called with no args).
 */
function createRoomHandle(client, baseConfig = {}) {
  const observability = createObservability();
  const transport = createTransport({ client, observability });
  const registry = createChannelRegistry({ transport, observability });

  function metrics() {
    return {
      ...observability.snapshot(),
      connected: transport.isConnected(),
      peers: transport.getPeers().size,
      channels: registry.all().length,
    };
  }

  return {
    async connect(cfg) {
      const room = await transport.connect({ ...baseConfig, ...cfg });
      registry.afterConnect();
      return room;
    },
    disconnect: transport.disconnect,
    isConnected: transport.isConnected,
    peers: transport.getPeers,
    getSessionId: transport.getSessionId,
    getRoomId: transport.getRoomId,

    channel: registry.channel,
    channels: registry.all,

    // Room membership events (the presence channel is the richer surface;
    // these are the raw join/leave for lobby and disconnect/forfeit logic).
    onPeerJoin: transport.onPeerJoin,
    onPeerLeave: transport.onPeerLeave,

    // Observability
    on: observability.on,
    metrics,
    onMetrics(cb, ms = 1000) {
      const id = setInterval(() => cb(metrics()), ms);
      return () => clearInterval(id);
    },

    getSettings,
    applySettings,
  };
}

async function openRoom(client, spec) {
  const handle = createRoomHandle(client, {});
  await handle.connect(spec);
  return handle;
}

/**
 * Create a realtime instance.
 *
 * The returned `rt` is the *default room handle* (declare channels, then
 * `rt.connect()`), and also opens further rooms that share its client + token.
 *
 * @param {Object} config
 * @param {string} [config.room]       Default room name.
 * @param {number} [config.maxClients] Max clients per room.
 * @param {string} [config.apiBase]    Token API base URL.
 * @param {string} [config.wsUrl]      Realtime WebSocket URL.
 * @param {string} [config.appGuid]    App GUID (auto-resolved if omitted).
 * @param {Object} [config.settings]   Timing / precision overrides.
 * @returns {Object} rt instance
 */
export function createRealtime(config = {}) {
  if (config.settings) applySettings(config.settings);

  const client = createClient();
  client.configure(config);

  const defaultRoom = createRoomHandle(client, config);

  return {
    ...defaultRoom,

    // ── Multi-room ──────────────────────────────────────────────────────
    /** Join (or create) a shared room - the lobby / directory pattern. */
    join(name, opts = {}) {
      return openRoom(client, { ...opts, room: name, mode: 'joinOrCreate' });
    },
    /** Create a fresh room instance - e.g. host a match. */
    create(name, opts = {}) {
      return openRoom(client, { ...opts, room: name, mode: 'create' });
    },
    /** Join a specific room instance by id - e.g. join an advertised match. */
    joinById(roomId, name, opts = {}) {
      return openRoom(client, { ...opts, roomId, room: name, mode: 'joinById' });
    },
    /** Discover live room instances - used by lobby / directory code. */
    listRooms(name) {
      return client.listRooms(name);
    },
    /** Pre-warm the app token. Resolves to the token, or null on failure. */
    ensureToken() {
      return client.acquireToken().catch(() => null);
    },
  };
}

export default createRealtime;

// The lobby-as-directory helper (a heartbeat'd store channel).
export { createDirectory };

// Static, engine-free helpers - adapters import these (e.g. to share the
// kit's quantization precision).
export {
  quantize, quantizeVec3, quantizeQuat,
  evaluateHost, chunkInit, assembleChunks, computeDrift,
  getSettings, applySettings,
};
