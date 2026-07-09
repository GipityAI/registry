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
import { createParty } from './lib/party.js';
import { RealtimeJoinError, toJoinError } from './lib/errors.js';
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
    isSynced: transport.isSynced,
    peers: transport.getPeers,
    getSessionId: transport.getSessionId,
    getRoomId: transport.getRoomId,
    getLastError: transport.getLastError,

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

// Multi-room opens fail LOUDLY: a null room here means the join failed (or
// there is no app GUID), and callers of join/create/joinById are exactly the
// ones that need to branch on why - full table, dead invite, bad code. The
// default room's connect() keeps its old null-on-failure contract.
async function openRoom(client, spec, context) {
  const handle = createRoomHandle(client, {});
  const room = await handle.connect(spec);
  if (!room) throw toJoinError(handle.getLastError(), context);
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
 * @param {string} [config.scope]      Instance partition key for the default
 *                                     room - same (room, scope) lands in the
 *                                     same instance, a different scope gets a
 *                                     separate instance of the same provisioned
 *                                     room. Feed it a URL param to give every
 *                                     team/session its own space.
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
    // All of these throw a RealtimeJoinError (err.code: 'full' | 'gone' |
    // 'not-found' | 'auth' | 'offline' | 'failed') when the join fails.
    /** Join (or create) a shared room - the lobby / directory pattern. */
    join(name, opts = {}) {
      return openRoom(client, { ...opts, room: name, mode: 'joinOrCreate' }, `join '${name}' failed`);
    },
    /** Join an EXISTING instance only - never creates. err.code 'not-found'
     *  when nothing matches (e.g. an invite code no live host is behind). */
    joinExisting(name, opts = {}) {
      return openRoom(client, { ...opts, room: name, mode: 'join' }, `join '${name}' failed`);
    },
    /** Create a fresh room instance - e.g. host a match. */
    create(name, opts = {}) {
      return openRoom(client, { ...opts, room: name, mode: 'create' }, `create '${name}' failed`);
    },
    /** Join a specific room instance by id - e.g. join an advertised match. */
    joinById(roomId, name, opts = {}) {
      return openRoom(client, { ...opts, roomId, room: name, mode: 'joinById' }, `join room ${roomId} failed`);
    },
    /** Discover live room instances - used by lobby / directory code. */
    listRooms(name, scope) {
      return client.listRooms(name, scope);
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

// The lobby-game harness: host / invite link / join-by-code / browse /
// quick-match, with cancel and typed failures. See lib/party.js.
export { createParty };

// Typed join failure - catch it and switch on err.code.
export { RealtimeJoinError };

// Static, engine-free helpers - adapters import these (e.g. to share the
// kit's quantization precision).
export {
  quantize, quantizeVec3, quantizeQuat,
  evaluateHost, chunkInit, assembleChunks, computeDrift,
  getSettings, applySettings,
};
