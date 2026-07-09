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
 *   const pub = dir.publish(matchId, { host: 'Sam', status: 'open' }); // host side
 *   pub.update({ status: 'playing' });                                 // this entry only
 *   pub.unpublish();
 *   dir.onChange(() => render(dir.list()));                            // reader side
 *
 * publish() returns a handle scoped to ITS key, so one peer can advertise
 * several entries (or replace one while another is pending) without the
 * handles clobbering each other. The top-level `update()` / `unpublish()`
 * operate on the most recently published entry - the convenient form for the
 * common one-entry-per-peer case.
 */

export function createDirectory(roomHandle, options = {}) {
  const channelName = options.channel || 'directory';
  const heartbeatMs = options.heartbeatMs ?? 15000;
  const staleMs = options.staleMs ?? 45000;

  const store = roomHandle.channel(channelName, { sync: 'store' });
  const mine = new Map();   // key -> entry (everything this peer is heart-beating)
  let lastKey = null;       // most recently published key (top-level update/unpublish)
  let hbTimer = null;

  function writeOne(key) {
    const entry = mine.get(key);
    if (entry) store.set(key, { ...entry, lastSeen: Date.now() });
  }
  function writeAll() {
    for (const key of mine.keys()) writeOne(key);
  }
  function stopHeartbeatIfIdle() {
    if (mine.size === 0 && hbTimer) { clearInterval(hbTimer); hbTimer = null; }
  }
  function unpublishKey(key) {
    if (!mine.has(key)) return;
    mine.delete(key);
    store.delete(key);
    if (lastKey === key) lastKey = mine.size ? [...mine.keys()].pop() : null;
    stopHeartbeatIfIdle();
  }
  function updateKey(key, patch) {
    const entry = mine.get(key);
    if (!entry) return;
    mine.set(key, { ...entry, ...patch });
    writeOne(key);
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

    /**
     * Publish (and start heart-beating) an entry under `key`. Returns a
     * handle scoped to this entry: `{ key, update(patch), unpublish() }`.
     */
    publish(key, entry) {
      mine.set(key, entry);
      lastKey = key;
      writeOne(key);
      if (!hbTimer) hbTimer = setInterval(writeAll, heartbeatMs);
      return {
        key,
        update: (patch) => updateKey(key, patch),
        unpublish: () => unpublishKey(key),
      };
    },

    /** Merge a patch into the most recently published entry. */
    update(patch) { if (lastKey) updateKey(lastKey, patch); },

    /** Remove the most recently published entry and stop heart-beating it. */
    unpublish() { if (lastKey) unpublishKey(lastKey); },

    /** Delete every entry that has stopped heart-beating (any reader may call). */
    sweep() {
      const now = Date.now();
      for (const [key, entry] of store.entries()) {
        if (now - (entry.lastSeen || 0) > staleMs) store.delete(key);
      }
    },

    /** React to directory changes - `cb()` on any entry add/update/remove. */
    onChange(cb) { return store.onChange(() => cb()); },

    /** Stop heart-beating everything (entries age out for other readers). */
    close() {
      if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
      mine.clear();
      lastKey = null;
    },
  };
}
