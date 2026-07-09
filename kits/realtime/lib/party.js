/**
 * @gipity/realtime - Party helper (lobby games done right)
 *
 * The whole "play with a friend / with strangers" flow in one place, so an app
 * never hand-rolls it: host a table, share an invite link or 4-char code, join
 * by code / link / browse list, or quick-match into any open table. Built on
 * the primitives (lobby room + directory + create/joinById) and closing the
 * failure modes every hand-rolled version has hit:
 *
 *   - hosting is cancelable: cancel() takes the table down BEFORE an opponent
 *     arrives - no ghost tables heart-beating forever, no stale closure later
 *     yanking the host into a match they abandoned
 *   - every join failure is a typed RealtimeJoinError ('not-found' | 'full' |
 *     'gone' | ...) - never a UI stuck on "Joining…"
 *   - one staleness window: the browse list, join-by-code, and quick-match all
 *     read the same directory freshness (no 18s-vs-45s divergence)
 *   - the invite URL is first-class: inviteUrl() builds it, joinFromUrl()
 *     consumes it - a link lands the friend at the same table, no typing
 *
 * Room names (`lobby`, `match` by default) must be provisioned - declare them
 * in gipity.yaml's realtime deploy phase.
 *
 *   const rt = createRealtime();
 *   const party = createParty(rt);
 *
 *   // Host: share table.code or table.inviteUrl
 *   const table = await party.host({ host: name });
 *   table.onJoin(() => startGame(table));
 *   backButton.onclick = () => table.cancel();
 *
 *   // Friend: the link joins for them (falls through when no ?join= param)
 *   const joined = await party.joinFromUrl();
 *   // ...or by typed code / from the browse list / against anyone:
 *   const t2 = await party.joinByCode(codeInput.value);
 *   const t3 = await party.quickMatch({ host: name });
 */

import { createDirectory } from './directory.js';
import { RealtimeJoinError, toJoinError } from './errors.js';

// Unambiguous code alphabet - no 0/O, 1/I/L, so codes survive being read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(length) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {Object} rt  A createRealtime() instance.
 * @param {Object} [options]
 * @param {string} [options.lobby='lobby']  Provisioned name of the shared lobby room.
 * @param {string} [options.match='match']  Provisioned name of the per-game room.
 * @param {number} [options.seats=2]        Players per table (host included).
 *                                          When the table fills, its listing
 *                                          flips to status 'playing' automatically.
 * @param {number} [options.codeLength=4]
 * @param {string} [options.urlParam='join']  Query param used by inviteUrl()/joinFromUrl().
 * @param {number} [options.heartbeatMs]    Directory heartbeat (default 15000).
 * @param {number} [options.staleMs]        Directory freshness window (default 45000).
 */
export function createParty(rt, options = {}) {
  const lobbyName = options.lobby ?? 'lobby';
  const matchName = options.match ?? 'match';
  const seats = options.seats ?? 2;
  const codeLength = options.codeLength ?? 4;
  const urlParam = options.urlParam ?? 'join';

  let lobby = null;   // lobby room handle
  let dir = null;     // directory over the lobby
  let lobbyPromise = null;

  function ensureLobby() {
    if (dir) return Promise.resolve(dir);
    if (!lobbyPromise) {
      lobbyPromise = (async () => {
        lobby = await rt.join(lobbyName);   // throws RealtimeJoinError on failure
        dir = createDirectory(lobby, {
          heartbeatMs: options.heartbeatMs,
          staleMs: options.staleMs,
        });
        return dir;
      })().catch((err) => { lobbyPromise = null; throw err; });
    }
    return lobbyPromise;
  }

  function openTables() {
    if (!dir) return [];
    dir.sweep();
    return dir.list().filter((e) => e.status === 'open');
  }

  /** Wrap a connected match room as a table handle. */
  function makeTable({ room, code, isHost, entry }) {
    let done = false;         // cancel()/leave() called - ignore late events

    function takeDown() {
      if (done) return;
      done = true;
      if (isHost && dir) dir.unpublish();
      room.disconnect();
    }

    const table = {
      isHost,
      code,
      roomId: room.getRoomId(),
      /** The match room handle - bind channels and events on this. */
      room,
      channel: room.channel,
      onPeerJoin: room.onPeerJoin,
      onPeerLeave: room.onPeerLeave,
      /** Invite link for this table (host side; '' outside a browser). */
      inviteUrl: inviteUrl(code),
      /** Everyone at the table right now, host/self included. */
      players() { return room.peers().size + 1; },
      /** cb() once when the table fills to `seats` players. */
      onFull(cb) {
        let fired = false;
        const off = room.onPeerJoin(() => {
          if (done || fired) return;
          if (table.players() >= seats) { fired = true; off(); cb(); }
        });
        return off;
      },
      /** Host: merge a patch into the table's lobby listing (e.g. status). */
      setListing(patch) { if (isHost && dir && !done) dir.update(patch); },
      /**
       * Host, pre-game: take the table down cleanly. The listing disappears
       * for everyone and no later joiner can resurrect the abandoned match.
       */
      cancel: takeDown,
      /** Leave the table (host leaving also delists it). */
      leave: takeDown,
    };

    // The moment the table fills, flip its listing so browsers/quick-match
    // stop steering joiners into it. Apps can still setListing() over this.
    if (isHost) {
      table.onFull(() => { if (dir && !done) dir.update({ status: 'playing' }); });
    }
    // Keep guests' entry metadata handy (host name etc).
    if (entry) table.entry = entry;

    return table;
  }

  /** Absolute invite URL carrying the table code ('' outside a browser). */
  function inviteUrl(code) {
    if (typeof location === 'undefined') return '';
    const u = new URL(location.href);
    u.searchParams.set(urlParam, code);
    u.hash = '';
    return u.toString();
  }

  function codeFromUrl() {
    if (typeof location === 'undefined') return null;
    return new URLSearchParams(location.search).get(urlParam);
  }

  async function joinEntry(entry) {
    await ensureLobby();
    if (!entry?.roomId) throw new RealtimeJoinError('not-found', 'invalid table entry');
    try {
      const room = await rt.joinById(entry.roomId, matchName);
      return makeTable({ room, code: entry.code, isHost: false, entry });
    } catch (err) {
      throw toJoinError(err, `joining table ${entry.code || entry.roomId} failed`);
    }
  }

  async function host(info = {}) {
    await ensureLobby();
    const room = await rt.create(matchName);
    let code = String(info.code || '').toUpperCase() || randomCode(codeLength);
    // A fresh entry already using this code gets a re-roll, not a collision.
    while (!info.code && dir.list().some((e) => e.code === code)) code = randomCode(codeLength);
    dir.publish(code, { ...info, code, roomId: room.getRoomId(), status: 'open' });
    return makeTable({ room, code, isHost: true });
  }

  async function joinByCode(rawCode, { timeoutMs = 8000 } = {}) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code) throw new RealtimeJoinError('not-found', 'no code given');
    await ensureLobby();

    const deadline = Date.now() + timeoutMs;
    const deadRoomIds = new Set();
    let lastErr = null;
    while (Date.now() < deadline) {
      const entry = dir.list().find((e) => e.code === code && !deadRoomIds.has(e.roomId));
      if (entry) {
        try {
          return await joinEntry(entry);
        } catch (err) {
          if (err.code === 'full') throw err;
          // 'gone': the entry outlived its room - ignore it and keep
          // waiting; a re-host under the same code publishes a new roomId.
          deadRoomIds.add(entry.roomId);
          lastErr = err;
        }
      }
      await sleep(250);
    }
    throw lastErr && lastErr.code !== 'gone'
      ? lastErr
      : new RealtimeJoinError('not-found', `no open table with code ${code}`);
  }

  return {
    /** Join the lobby (idempotent) - resolves once the browse list is live. */
    open: () => ensureLobby().then(() => undefined),

    /** The lobby room handle (null until open()/host()/join* has run). */
    lobbyRoom: () => lobby,

    /**
     * Live browse list: cb(entries) now and on every directory change. Each
     * entry is a published table ({ code, status, ...hostInfo }); only fresh,
     * status 'open' entries are delivered. Returns an unsubscribe fn.
     */
    async onTables(cb) {
      await ensureLobby();
      const off = dir.onChange(() => cb(openTables()));
      cb(openTables());
      return off;
    },

    /** One-shot snapshot of open tables. */
    async tables() {
      await ensureLobby();
      return openTables();
    },

    /**
     * Host a table: creates a match room, advertises it under a share code.
     * `info` is merged into the listing (e.g. { host: 'Sam' }); pass
     * `info.code` to force a specific code (e.g. a rematch).
     * @returns table - share table.code / table.inviteUrl, wire table.onFull,
     *                  and call table.cancel() if the host backs out.
     */
    host,

    /**
     * Join a table by its share code. Waits (default 8s) for the code to
     * appear in the directory - a joiner often clicks faster than the host's
     * entry syncs. Throws RealtimeJoinError: 'not-found' (no such code),
     * 'full' (seats taken), 'gone' (host left).
     */
    joinByCode,

    /** Join a specific browse-list entry. Throws 'full' / 'gone'. */
    join: joinEntry,

    /**
     * Play against anyone: join the oldest open table, else host a new one.
     * @returns table - check table.isHost to know which way it went.
     */
    async quickMatch(info = {}) {
      await ensureLobby();
      const candidates = openTables().sort((a, b) => (a.lastSeen || 0) - (b.lastSeen || 0));
      for (const entry of candidates) {
        try {
          return await joinEntry(entry);
        } catch {
          // full or gone - try the next table
        }
      }
      return host(info);
    },

    /** Build an invite URL for a code (same shape joinFromUrl consumes). */
    inviteUrl,

    /** The invite code in the current page URL, or null. */
    codeFromUrl,

    /**
     * Follow an invite link: when the page URL carries a code, join that
     * table (throwing the usual typed errors); resolves null when it doesn't.
     */
    async joinFromUrl(opts) {
      const code = codeFromUrl();
      if (!code) return null;
      return joinByCode(code, opts);
    },

    /** Leave the lobby (open tables you host are delisted by their handles). */
    close() {
      if (lobby) lobby.disconnect();
      lobby = null;
      dir = null;
      lobbyPromise = null;
    },
  };
}
