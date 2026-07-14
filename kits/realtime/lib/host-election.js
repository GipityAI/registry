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
  let heartbeat = null;

  const send = (t, d) => transport.send(M(t), d);
  const on = (t, cb) => transport.on(M(t), cb);
  const peerCount = () => transport.getPeers().size + 1;

  // The host re-asserts itself on an interval. This is what makes the
  // watchdog below trustworthy: host-confirmed carries `sid`, so it refreshes
  // the transport's lastSeen for the host. Without it, a host that runs no
  // presence channel is silent between keyframes (which carry no sid) and a
  // watchdog would re-elect against a perfectly live host — which is why the
  // watchdog used to be armed only for claim-losers, leaving every fast-path
  // joiner unguarded against a crashed host (observed: dead host, survivors
  // waited the server's full 30s seat-hold before recovering).
  function startHeartbeat() {
    stopHeartbeat();
    const period = Math.max(250, Math.floor(getSettings().hostLossMs / 2));
    heartbeat = setInterval(() => {
      if (isHost) send('host-confirmed', { sid: transport.getSessionId() });
    }, period);
  }
  function stopHeartbeat() {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  }

  function becomeHost(reason) {
    const myId = transport.getSessionId();
    isHost = true;
    confirmedHostId = myId;
    console.log(`[realtime] ★ HOST - ${reason}`);
    send('host-confirmed', { sid: myId });
    stopWatchdog();
    startHeartbeat();
    callbacks.onBecomeHost?.();
    callbacks.onHostChange?.(true, 1, peerCount());
  }

  function becomeNonHost() {
    isHost = false;
    stopHeartbeat();
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
      // Rank only against peers that are provably alive. A crashed peer stays
      // in the server's player map for its whole reconnection hold (30s) —
      // ranking against it meant a dead low-sid host kept "winning" and no
      // survivor ever claimed. The cutoff must be AT MOST the watchdog's
      // trigger age (hostLossMs): the watchdog only re-elects once the host
      // has been silent that long, so a looser cutoff here re-admits the very
      // peer we just declared dead. If a filtered-out peer is actually alive,
      // the collision handler resolves the double-host deterministically.
      const s = getSettings();
      const fresh = [...transport.getPeers().entries()]
        .filter(([, p]) => Date.now() - (p.lastSeen || 0) <= s.hostLossMs)
        .map(([sid]) => sid);
      const result = evaluateHost(myId, fresh);
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
      if (isHost) return;
      if (!confirmedHostId) {
        // Headless (the last election failed to seat anyone, e.g. every
        // candidate looked stale mid-transition) - keep trying, don't go
        // inert; peers only get staler, so a survivor eventually claims.
        electHost();
        return;
      }
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
        stopHeartbeat();
        callbacks.onResign?.();
      } else if (confirmedHostId && hostSid > confirmedHostId) {
        // Already tracking a lower-id (higher-priority) host - ignore this one.
        return;
      }
      confirmedHostId = hostSid;
      // Guard the remote host from here on - EVERY non-host tracks it, not
      // just claim-losers (see startHeartbeat for why this is now safe).
      startWatchdog();
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
        startWatchdog();
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
    transport.onDisconnect(() => { stopWatchdog(); stopHeartbeat(); });

    return ready;
  }

  return {
    init,
    isHost: () => isHost,
    getConfirmedHostId: () => confirmedHostId,
    reset() { isHost = false; confirmedHostId = null; stopWatchdog(); stopHeartbeat(); },
  };
}
