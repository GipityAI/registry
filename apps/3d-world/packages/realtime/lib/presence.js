/**
 * @gipity/realtime - Presence channel
 *
 * Ephemeral per-peer state (cursors, positions, "who's editing", typing).
 * Broadcast on custom messages at ~20 Hz and continuously rebroadcast, so
 * late joiners converge without a replay and a crashed peer simply goes
 * stale - never a persisted, orphaned record. This is why presence does NOT
 * use the data map.
 */

import { getSettings } from './settings.js';

export function createPresenceChannel({ name, transport, adapter, observability }) {
  const pres = adapter.presence;
  const wireType = `${name}:presence`;

  const peers = new Map();   // sid -> peer record
  let localState = null;     // set via setLocal() when no adapter.encode
  let sent = 0;

  const changeCbs = new Set();
  const joinCbs = new Set();
  const leaveCbs = new Set();
  const fire = (set, ...a) => { for (const cb of set) { try { cb(...a); } catch (e) { console.warn('[realtime] presence cb error', e); } } };

  // --- incoming ---
  transport.on(wireType, (data) => {
    if (!data || data.sid === transport.getSessionId()) return;
    let peer = peers.get(data.sid);
    const isNew = !peer;
    if (isNew) { peer = pres.newPeer(); peers.set(data.sid, peer); }
    pres.apply(peer, data);
    peer.lastSeen = Date.now();
    if (isNew) fire(joinCbs, data.sid, peer);
    fire(changeCbs, data.sid, peer);
  });

  transport.onPeerLeave((sid) => {
    if (peers.delete(sid)) fire(leaveCbs, sid);
  });

  // --- outgoing broadcast loop ---
  const broadcast = setInterval(() => {
    const payload = pres.encode() ?? localState;
    if (payload) {
      transport.send(wireType, { sid: transport.getSessionId(), ...payload });
      sent++;
    }
  }, getSettings().posRateMs);

  // --- stale sweep (backup for missed peer-leave) ---
  const sweep = setInterval(() => {
    const cutoff = Date.now() - getSettings().staleTimeoutMs * 3;
    for (const [sid, peer] of peers) {
      if (peer.lastSeen && peer.lastSeen < cutoff) {
        peers.delete(sid);
        fire(leaveCbs, sid);
      }
    }
  }, 2000);

  transport.onDisconnect(() => { clearInterval(broadcast); clearInterval(sweep); });

  return {
    sync: 'presence',
    name,
    setLocal(obj) { localState = obj; },
    local() { return localState; },
    peers() { return peers; },
    onChange(cb) { changeCbs.add(cb); return () => changeCbs.delete(cb); },
    onJoin(cb) { joinCbs.add(cb); return () => joinCbs.delete(cb); },
    onLeave(cb) { leaveCbs.add(cb); return () => leaveCbs.delete(cb); },
    metrics() { return { peers: peers.size, broadcasts: sent }; },
  };
}
