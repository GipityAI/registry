/**
 * @gipity/realtime - Host Election
 *
 * 3-phase claim-based election (Bully variant) with watchdog. Used by an
 * `entities` channel with `authority:'host'` to pick the peer that owns the
 * authoritative simulation. Fully generic - no engine code.
 *
 * Election messages are namespaced with the channel name so multiple host
 * channels never collide.
 */

import { evaluateHost } from './protocol.js';
import { getSettings } from './settings.js';

export function createHostElection({ name, transport }) {
  const M = (t) => `${name}:${t}`;

  let isHost = false;
  let confirmedHostId = null;
  let callbacks = {};
  let watchdog = null;

  const send = (t, d) => transport.send(M(t), d);
  const on = (t, cb) => transport.on(M(t), cb);
  const peerCount = () => transport.getPeers().size + 1;

  function becomeHost(reason) {
    const myId = transport.getSessionId();
    isHost = true;
    confirmedHostId = myId;
    console.log(`[realtime] ★ HOST - ${reason}`);
    send('host-confirmed', { sid: myId });
    stopWatchdog();
    callbacks.onBecomeHost?.();
    callbacks.onHostChange?.(true, 1, peerCount());
  }

  function becomeNonHost() {
    isHost = false;
    callbacks.onBecomeNonHost?.();
    callbacks.onHostChange?.(false, Math.min(peerCount(), 2), peerCount());
    startWatchdog();
  }

  function electHost() {
    const myId = transport.getSessionId();
    if (!myId) return;

    if (callbacks.hasWorldData?.() && !isHost) {
      isHost = true;
      confirmedHostId = myId;
      console.log('[realtime] ★ HOST (previous host left, we have data)');
      send('host-confirmed', { sid: myId });
      callbacks.onBecomeHost?.();
    } else if (!isHost) {
      const result = evaluateHost(myId, [...transport.getPeers().keys()]);
      isHost = result.isHost;
      if (isHost) {
        confirmedHostId = myId;
        console.log('[realtime] ★ HOST (alphabetical fallback)');
        send('host-confirmed', { sid: myId });
        callbacks.onBecomeHost?.();
      }
    }
    callbacks.onHostChange?.(isHost, isHost ? 1 : 2, peerCount());
  }

  function updatePeerCount() {
    callbacks.onHostChange?.(isHost, isHost ? 1 : Math.min(peerCount(), 2), peerCount());
  }

  function startWatchdog() {
    stopWatchdog();
    const { hostLossMs } = getSettings();
    watchdog = setInterval(() => {
      if (isHost || !confirmedHostId) return;
      if (confirmedHostId === transport.getSessionId()) return;
      const host = transport.getPeers().get(confirmedHostId);
      if (!host) { confirmedHostId = null; electHost(); return; }
      if (Date.now() - (host.lastSeen || 0) > hostLossMs) {
        console.warn(`[realtime] ⚠ host ${confirmedHostId} silent - re-electing`);
        confirmedHostId = null;
        electHost();
      }
    }, 500);
  }
  function stopWatchdog() {
    if (watchdog) { clearInterval(watchdog); watchdog = null; }
  }

  function init(cbs = {}) {
    callbacks = cbs;
    const { pingWaitMs, claimWaitMs, syncTimeoutMs } = getSettings();
    const myId = transport.getSessionId();
    console.log(`[realtime] election init (${name}) myId=${myId}`);

    let resolveReady;
    const ready = new Promise((r) => { resolveReady = r; });

    on('host-confirmed', (data) => {
      const hostSid = data?.sid;
      if (!hostSid || hostSid === myId || hostSid === confirmedHostId) return;
      if (isHost) {
        // Two clients self-elected - their ping windows missed each other.
        // Resolve it deterministically: the lower session id is the host.
        if (myId < hostSid) { send('host-confirmed', { sid: myId }); return; }
        isHost = false;
        callbacks.onResign?.();
      } else if (confirmedHostId && hostSid > confirmedHostId) {
        // Already tracking a lower-id (higher-priority) host - ignore this one.
        return;
      }
      confirmedHostId = hostSid;
      callbacks.onHostConfirmed?.(hostSid);
      updatePeerCount();
    });

    on('host-claim', () => {
      if (isHost && confirmedHostId === myId) send('host-confirmed', { sid: myId });
    });

    const pongs = new Set();
    on('pong', (data) => { if (data?.sid && data.sid !== myId) pongs.add(data.sid); });
    on('ping', (data) => {
      if (data?.sid && data.sid !== myId) {
        send('pong', { sid: myId });
        if (isHost && confirmedHostId === myId) send('host-confirmed', { sid: myId });
      }
    });
    send('ping', { sid: myId });

    setTimeout(() => {
      if (confirmedHostId && confirmedHostId !== myId) {
        callbacks.onHostConfirmed?.(confirmedHostId);
        resolveReady({ isHost: false });
        return;
      }
      if (pongs.size === 0) {
        becomeHost('solo (0 pong replies)');
        resolveReady({ isHost: true });
        return;
      }

      const claims = new Set([myId]);
      on('host-claim', (data) => { if (data?.sid && data.sid !== myId) claims.add(data.sid); });
      send('host-claim', { sid: myId });

      setTimeout(() => {
        if (confirmedHostId && confirmedHostId !== myId) { resolveReady({ isHost: false }); return; }
        const winner = [...claims].sort()[0];
        if (winner === myId) {
          becomeHost(`claim winner (${claims.size} claims)`);
          resolveReady({ isHost: true });
        } else {
          becomeNonHost();
          setTimeout(() => {
            if (!callbacks.hasWorldData?.() && !isHost) {
              becomeHost('sync timeout (winner unresponsive)');
              resolveReady({ isHost: true });
            }
          }, syncTimeoutMs);
          resolveReady({ isHost: false });
        }
      }, claimWaitMs);
    }, pingWaitMs);

    transport.onPeerLeave((sid) => {
      console.log(`[realtime] peer left: ${sid}${sid === confirmedHostId ? ' (was host)' : ''}`);
      if (sid === confirmedHostId) confirmedHostId = null;
      setTimeout(() => { if (!isHost) electHost(); else updatePeerCount(); }, 50);
    });
    transport.onPeerJoin((sid) => {
      setTimeout(() => {
        updatePeerCount();
        if (isHost) {
          send('host-confirmed', { sid: myId });
          callbacks.onNewPeer?.(sid);
        }
      }, 50);
    });
    transport.onDisconnect(() => stopWatchdog());

    return ready;
  }

  return {
    init,
    isHost: () => isHost,
    getConfirmedHostId: () => confirmedHostId,
    reset() { isHost = false; confirmedHostId = null; stopWatchdog(); },
  };
}
