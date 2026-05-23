/**
 * @gipity/realtime - Directory helper
 *
 * The lobby-as-directory pattern: a shared room whose `store` channel lists
 * what is open - matches, sessions, documents. Each publisher heartbeats its
 * own entry; readers list only entries still heart-beating and sweep the rest.
 * A crashed publisher's entry simply ages out.
 *
 *   const lobby = await rt.join('lobby');
 *   const dir = createDirectory(lobby);
 *   dir.publish(matchId, { host: 'Sam', status: 'open' });   // host side
 *   dir.onChange(() => render(dir.list()));                  // reader side
 */

export function createDirectory(roomHandle, options = {}) {
  const channelName = options.channel || 'directory';
  const heartbeatMs = options.heartbeatMs ?? 15000;
  const staleMs = options.staleMs ?? 45000;

  const store = roomHandle.channel(channelName, { sync: 'store' });
  let myKey = null;
  let myEntry = null;
  let hbTimer = null;

  function writeMine() {
    if (myKey) store.set(myKey, { ...myEntry, lastSeen: Date.now() });
  }
  function stopHeartbeat() {
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
  }

  return {
    /** The underlying store channel, if you need direct access. */
    store,

    /** Every entry still heart-beating, each with its `_key`. */
    list() {
      const now = Date.now();
      return store.entries()
        .map(([key, entry]) => ({ ...entry, _key: key }))
        .filter((entry) => now - (entry.lastSeen || 0) <= staleMs);
    },

    /** Publish (and start heart-beating) this peer's own entry. */
    publish(key, entry) {
      myKey = key;
      myEntry = entry;
      writeMine();
      if (!hbTimer) hbTimer = setInterval(writeMine, heartbeatMs);
    },

    /** Merge a patch into this peer's published entry. */
    update(patch) {
      if (!myKey) return;
      myEntry = { ...myEntry, ...patch };
      writeMine();
    },

    /** Remove this peer's entry and stop heart-beating. */
    unpublish() {
      if (myKey) store.delete(myKey);
      myKey = null;
      myEntry = null;
      stopHeartbeat();
    },

    /** Delete every entry that has stopped heart-beating (any reader may call). */
    sweep() {
      const now = Date.now();
      for (const [key, entry] of store.entries()) {
        if (now - (entry.lastSeen || 0) > staleMs) store.delete(key);
      }
    },

    /** React to directory changes - `cb()` on any entry add/update/remove. */
    onChange(cb) { return store.onChange(() => cb()); },
  };
}
