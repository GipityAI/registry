/**
 * 3D World - Multiplayer Feature
 *
 * Toggle for the @gipity/realtime connection + (optional) world-state sync.
 * Disabling leaves every realtime channel a safe no-op - other features
 * (rocket-launcher, etc.) keep working in solo offline mode.
 *
 * Enable in config.js:
 *   features: { 'multiplayer': true }                                  // basic mp (connect + player tracking)
 *   features: { 'multiplayer': { room: 'arena', maxClients: 8 } }      // custom room
 *   features: { 'multiplayer': { sync: { worldState: true } } }        // + host election + full world sync
 *   features: { 'multiplayer': false }                                 // solo mode (no network)
 *
 * Disable + a single-player game = no Colyseus connection at all.
 */

export const DEFAULTS = {
  room: 'game-lobby',
  maxClients: 10,
  apiBase: '{{API_BASE}}',
  wsUrl: 'wss://rt.gipity.ai',
  /** Optional - override timing/precision (see packages/realtime/lib/settings.js). */
  settings: null,
  /**
   * sync.worldState: if true, create the host-authoritative 'world' entities
   * channel. Host election + transform sync run inside that channel; the 3D
   * adapter (network/adapter-3d.js) supplies its entities/authority sections.
   * Suitable for shared-world games (e.g. block sandbox). For games where
   * each client owns its own scene, leave this off.
   */
  sync: { worldState: false },
};

// Distinct colors so remote players are visually separable from each other
// and from the local player.
const AVATAR_COLORS = [0x2196f3, 0xe91e63, 0xffc107, 0x9c27b0, 0x00bcd4, 0x8bc34a];
function colorForPeer(sid) {
  let h = 0;
  for (let i = 0; i < sid.length; i++) h = (h * 31 + sid.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function create(config, deps) {
  const { network, ui, scene, player } = deps;

  // Remote-player avatars: visual-only meshes driven by the 'avatars'
  // presence channel. Not physics bodies - their position is authoritative
  // from the network, so physics must not fight it.
  const avatars = new Map(); // sessionId -> THREE.Group
  let leaveUnsub = null;
  let syncOverlay = null;

  // Full-screen cover shown until the player is unfrozen - so a joiner never
  // sees its own un-synced scene flash before the host's world lands.
  function showSyncOverlay() {
    if (syncOverlay || typeof document === 'undefined') return;
    syncOverlay = document.createElement('div');
    syncOverlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0a0a0f;' +
      'display:flex;align-items:center;justify-content:center;color:#9aa;' +
      'font:14px monospace;letter-spacing:1px;';
    syncOverlay.textContent = 'Syncing world…';
    document.body.appendChild(syncOverlay);
  }
  function hideSyncOverlay() {
    if (syncOverlay) { syncOverlay.remove(); syncOverlay = null; }
  }

  function removeAvatar(sid) {
    const mesh = avatars.get(sid);
    if (mesh) { scene.remove(mesh); avatars.delete(sid); }
  }

  return {
    config,

    async init() {
      // World-state games: cover the screen up front so the un-synced demo
      // scene is never visible. Lifted once the player unfreezes (see update).
      if (config.sync?.worldState) showSyncOverlay();

      // Open the connection (or no-op if no app GUID / token fails).
      const room = await network.initNetwork({
        room: config.room,
        maxClients: config.maxClients,
        apiBase: config.apiBase,
        wsUrl: config.wsUrl,
        settings: config.settings,
      });

      // Local presence is broadcast automatically by the 'avatars' presence
      // channel - the 3D adapter's encode() reads the player position each
      // tick. Here we render the *remote* peers it tracks.
      leaveUnsub = network.avatars.onLeave(removeAvatar);

      // Give the local player a network-consistent color: each client derives
      // its color from its own session id and broadcasts it via presence, so
      // every screen renders this player the same hue.
      if (room) {
        const sid = network.rt?.getSessionId?.();
        if (sid) player.setPlayerColor(colorForPeer(sid));
      }

      // World-state sync. The 'world' entities channel runs host election +
      // transform sync internally. The local player freezes until its role is
      // settled - the host plays at once; a joiner unfreezes when the host's
      // full world sync lands.
      if (room && config.sync?.worldState) {
        player.freezePlayer();
        const world = network.enableWorldSync();
        world.onSynced(() => player.unfreezePlayer());
      }

      // Tiny "realtime: connected" badge if the UI module supports HUD slots.
      if (room && ui?.setHud) {
        ui.setHud('top-right', `<div style="font-size:11px;color:#0a0;font-family:monospace">● realtime</div>`);
      }
    },

    update(dt) {
      // Reveal the world once the player is unfrozen (world synced, or host).
      if (syncOverlay && !player.isFrozen?.()) hideSyncOverlay();

      // Spawn / move a mesh for every remote peer in the presence channel.
      for (const [sid, peer] of network.avatars.peers()) {
        if (!peer.position) continue;
        let mesh = avatars.get(sid);
        if (!mesh) {
          mesh = player.buildPlayerModel(peer.color || colorForPeer(sid));
          // Per-peer animation bookkeeping - peers send no velocity, so the
          // walk cycle is driven by how fast their position is changing.
          mesh.userData.peerAnim = {
            lastX: peer.position.x, lastZ: peer.position.z, speed: 0,
          };
          scene.add(mesh);
          avatars.set(sid, mesh);
        }
        // Smooth toward the last received position (presence arrives ~20 Hz).
        mesh.position.x += (peer.position.x - mesh.position.x) * 0.25;
        mesh.position.y += (peer.position.y - mesh.position.y) * 0.25;
        mesh.position.z += (peer.position.z - mesh.position.z) * 0.25;
        mesh.rotation.y = peer.rotation || 0;

        // Derive horizontal speed from the change in the *authoritative* peer
        // position, heavily smoothed - presence is ~20 Hz vs ~60 Hz render, so
        // the raw per-frame delta is a stair-step we'd otherwise see as jitter.
        const pa = mesh.userData.peerAnim;
        const dx = peer.position.x - pa.lastX;
        const dz = peer.position.z - pa.lastZ;
        pa.lastX = peer.position.x;
        pa.lastZ = peer.position.z;
        const inst = Math.sqrt(dx * dx + dz * dz) / Math.max(dt, 1e-3);
        pa.speed += (inst - pa.speed) * 0.12;

        player.animatePlayerModel(mesh, {
          speed: pa.speed,
          grounded: peer.grounded !== false,
        }, dt);
      }
    },

    destroy() {
      hideSyncOverlay();
      if (leaveUnsub) leaveUnsub();
      for (const mesh of avatars.values()) scene.remove(mesh);
      avatars.clear();
    },
  };
}
