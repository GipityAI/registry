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
 *     yanking the host into a match they abandoned. Hosting again while a
 *     table is still waiting replaces it (the old one is auto-canceled).
 *   - every join failure is a typed RealtimeJoinError ('not-found' | 'full' |
 *     'gone' | ...) - never a UI stuck on "Joining…". A table whose listing is
 *     no longer 'open' rejects as 'full' client-side even when the room's
 *     provisioned max_clients is larger than `seats`.
 *   - one staleness window: the browse list, join-by-code, and quick-match all
 *     read the same directory freshness (no 18s-vs-45s divergence)
 *   - the invite URL is first-class: inviteUrl() builds it, joinFromUrl()
 *     consumes it - a link lands the friend at the same table, no typing
 *
 * Room names (`lobby`, `match` by default) must be provisioned - declare them
 * in gipity.yaml's realtime deploy phase. For hard server-side seat limits,
 * provision `match` with `max_clients` matching your `seats` (the kit's own
 * install block leaves it open so N-player games work; `seats` gates joins
 * client-side either way).
 *
 *   const rt = createRealtime();
 *   const party = createParty(rt);
 *
 *   // Host: share table.code or table.inviteUrl
 *   const table = await party.host({ host: name });
 *   table.onFull(() => startGame(table));
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

// How long ensureLobby waits for the lobby's first state sync before giving
// up and resolving anyway. A fresh, EMPTY lobby room never receives a
// data-bearing patch, so onReady may never fire - the cap keeps open() fast
// there while a populated lobby resolves as soon as its entries arrive.
const LOBBY_SYNC_WAIT_MS = 800;

/**
 * @param {Object} rt  A createRealtime() instance.
 * @param {Object} [options]
 * @param {string} [options.lobby='lobby']  Provisioned name of the shared lobby room.
 * @param {string} [options.match='match']  Provisioned name of the per-game room.
 * @param {number} [options.seats=2]        Players per table (host included).
 *                                          When the table fills, its listing
 *                                          flips to status 'playing' automatically
 *                                          and further joins reject as 'full'.
 * @param {number} [options.codeLength=4]
 * @param {string} [options.urlParam='join']  Query param used by inviteUrl()/joinFromUrl().
 * @param {number} [options.heartbeatMs]    Directory heartbeat (default 15000).
 * @param {number} [options.staleMs]        Directory freshness window (default 45000).
 * @param {number} [options.syncWaitMs]     Cap on waiting for the lobby's first
 *                                          state sync when opening (default 800).
 */
export function createParty(rt, options = {}) {
  const lobbyName = options.lobby ?? 'lobby';
  const matchName = options.match ?? 'match';
  const seats = options.seats ?? 2;
  const codeLength = options.codeLength ?? 4;
  const urlParam = options.urlParam ?? 'join';

  let lobby = null;        // lobby room handle
  let dir = null;          // directory over the lobby
  let lobbyPromise = null;
  let epoch = 0;           // bumped by close()/loss so stale opens are discarded
  let hostedTable = null;  // the table this peer is hosting, until it starts/cancels

  function resetLobby() {
    if (dir) dir.close();
    lobby = null;
    dir = null;
    lobbyPromise = null;
  }

  function ensureLobby() {
    if (dir) return Promise.resolve(dir);
    if (!lobbyPromise) {
      const myEpoch = epoch;
      lobbyPromise = (async () => {
        const room = await rt.join(lobbyName);   // throws RealtimeJoinError on failure
        if (myEpoch !== epoch) {                 // close() raced the join - undo it
          room.disconnect();
          throw new RealtimeJoinError('failed', 'party was closed');
        }
        const d = createDirectory(room, {
          heartbeatMs: options.heartbeatMs,
          staleMs: options.staleMs,
        });
        // Wait for the first state sync so list()/collision checks see the
        // real directory, capped for the empty-lobby case (see constant).
        const cap = options.syncWaitMs ?? LOBBY_SYNC_WAIT_MS;
        if (cap > 0) {
          await Promise.race([
            new Promise((r) => d.store.onReady(r)),
            sleep(cap),
          ]);
        }
        // A permanently lost lobby leaves a frozen mirror and a pointless
        // heartbeat - reset so the next party call re-joins cleanly.
        room.on('lost', () => { if (myEpoch === epoch) resetLobby(); });
        lobby = room;
        dir = d;
        return d;
      })().catch((err) => { lobbyPromise = null; throw err; });
    }
    return lobbyPromise;
  }

  function openTables() {
    if (!dir) return [];
    dir.sweep();
    return dir.list().filter((e) => e.status === 'open');
  }

  /** Wrap a connected match room as a table handle. `pub` is the host's
   *  per-key directory publisher (null for guests). */
  function makeTable({ room, code, isHost, entry, pub }) {
    let done = false;         // cancel()/leave() called - ignore late events

    function takeDown() {
      if (done) return;
      done = true;
      if (pub) pub.unpublish();
      if (hostedTable === table) hostedTable = null;
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
      /** cb() once when the table fills to `seats` players (fires immediately
       *  when it is already full at registration time). */
      onFull(cb) {
        let fired = false;
        const fire = () => { if (!done && !fired) { fired = true; off(); cb(); } };
        const off = room.onPeerJoin(() => {
          if (table.players() >= seats) fire();
        });
        if (table.players() >= seats) Promise.resolve().then(fire);
        return off;
      },
      /** Host: merge a patch into the table's lobby listing (e.g. status). */
      setListing(patch) { if (pub && !done) pub.update(patch); },
      /**
       * Host, pre-game: take the table down cleanly. The listing disappears
       * for everyone and no later joiner can resurrect the abandoned match.
       */
      cancel: takeDown,
      /** Leave the table (host leaving also delists it). */
      leave: takeDown,
    };

    // The moment the table fills, flip its listing so browsers/quick-match
    // stop steering joiners into it (and joinByCode rejects as 'full').
    // Apps can still setListing() over this.
    if (isHost) {
      table.onFull(() => { if (pub && !done) pub.update({ status: 'playing' }); });
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
    // Client-side seat gate: a listing that is no longer 'open' means the
    // table filled (or the host closed joins) - reject even when the room's
    // provisioned max_clients would still admit us.
    if (entry.status && entry.status !== 'open') {
      throw new RealtimeJoinError('full', `table ${entry.code || entry.roomId} is already ${entry.status}`);
    }
    try {
      const room = await rt.joinById(entry.roomId, matchName);
      return makeTable({ room, code: entry.code, isHost: false, entry, pub: null });
    } catch (err) {
      throw toJoinError(err, `joining table ${entry.code || entry.roomId} failed`);
    }
  }

  async function host(info = {}) {
    await ensureLobby();
    // Hosting again while a previous table is still waiting replaces it -
    // otherwise the old room lives on and its listing goes stale-but-joinable.
    if (hostedTable) hostedTable.cancel();
    const room = await rt.create(matchName);
    let code = String(info.code || '').toUpperCase() || randomCode(codeLength);
    // A fresh entry already using this code gets a re-roll, not a collision.
    while (!info.code && dir.list().some((e) => e.code === code)) code = randomCode(codeLength);
    const pub = dir.publish(code, { ...info, code, roomId: room.getRoomId(), seats, status: 'open' });
    const table = makeTable({ room, code, isHost: true, pub });
    hostedTable = table;
    return table;
  }

  async function joinByCode(rawCode, { timeoutMs = 8000 } = {}) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code) throw new RealtimeJoinError('not-found', 'no code given');
    await ensureLobby();

    const deadline = Date.now() + timeoutMs;
    const deadRoomIds = new Set();
    while (Date.now() < deadline) {
      const entry = dir.list().find((e) => e.code === code && !deadRoomIds.has(e.roomId));
      if (entry) {
        try {
          return await joinEntry(entry);
        } catch (err) {
          if (err.code !== 'gone') throw err;   // 'full'/'auth'/... fail fast
          // 'gone': the entry outlived its room - ignore it and keep
          // waiting; a re-host under the same code publishes a new roomId.
          deadRoomIds.add(entry.roomId);
        }
      }
      await sleep(250);
    }
    throw new RealtimeJoinError('not-found', `no open table with code ${code}`);
  }

  return {
    /** Join the lobby (idempotent) - resolves once the browse list is live. */
    open: () => ensureLobby().then(() => undefined),

    /** The lobby room handle (null until open()/host()/join* has run). */
    lobbyRoom: () => lobby,

    /**
     * Live browse list: cb(entries) now and on every directory change. Each
     * entry is a published table ({ code, status, seats, ...hostInfo }); only
     * fresh, status 'open' entries are delivered. Returns an unsubscribe fn.
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
     * `info.code` to force a specific code (e.g. a rematch). Replaces any
     * previous still-waiting hosted table.
     * @returns table - share table.code / table.inviteUrl, wire table.onFull,
     *                  and call table.cancel() if the host backs out.
     */
    host,

    /**
     * Join a table by its share code. Waits (default 8s) for the code to
     * appear in the directory - a joiner often clicks faster than the host's
     * entry syncs. Throws RealtimeJoinError: 'not-found' (no such code),
     * 'full' (seats taken / already playing), 'gone' (host left).
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

    /** Leave the lobby and stop heart-beating (a still-waiting hosted table
     *  is canceled; an in-flight open() is discarded). */
    close() {
      epoch += 1;
      if (hostedTable) hostedTable.cancel();
      if (lobby) lobby.disconnect();
      resetLobby();
    },
  };
}
