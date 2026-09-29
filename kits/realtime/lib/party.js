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
 *     provisioned max_clients is larger than `seats` - except for a player
 *     whose own seat there is still held (their page died without a clean
 *     leave): the invite link / code takes that held seat back.
 *   - a full table reopens by itself: the kit flips the listing to 'playing'
 *     when it fills and back to 'open' when a seat frees (a player left, or a
 *     dropped player's seat hold ran out) - unless the app set the status
 *     itself with setListing(), which the kit then leaves alone.
 *   - one staleness window: the browse list, join-by-code, and quick-match all
 *     read the same directory freshness (no 18s-vs-45s divergence)
 *   - the invite URL is first-class: inviteUrl() builds it, joinFromUrl()
 *     consumes it - a link lands the friend at the same table, no typing
 *   - the host role can move (opt-in handoff): host({ handoff: true }) and
 *     peers that join with { canHost: true } let the server hand the role to
 *     a peer when the host's page goes away or stops running. The new host
 *     gets the old host's last setCheckpoint() in onHostChange, and takes
 *     over the table's lobby listing so invite links and codes keep working.
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
import { readStored, writeStored } from './storage.js';

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
 * @param {number} [options.seats=2]        Clients per table, the host's page
 *                                          included (a TV + 8 phones = 9). When
 *                                          the table fills, its listing flips to
 *                                          status 'playing' automatically and
 *                                          further joins reject as 'full'; when
 *                                          a seat frees it flips back to 'open'.
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
   *  per-key directory publisher (null for guests); `listing` is the table's
   *  lobby entry, republished by whichever page holds the host role. */
  function makeTable({ room, code, entry, pub: initialPub, listing }) {
    let done = false;         // cancel()/leave() called - ignore late events
    let pub = initialPub;     // non-null while this page publishes the listing

    function takeDown() {
      if (done) return;
      done = true;
      if (pub) pub.unpublish();
      pub = null;
      if (hostedTable === table) hostedTable = null;
      if (room.isHost()) forgetHostedTable();
      room.disconnect();
    }

    // The listing status this host last published, and whether the kit (not
    // the app) is driving it.
    let status = 'open';
    let kitOwnsStatus = true;

    const table = {
      code,
      roomId: room.getRoomId(),
      /** The match room handle - bind channels and events on this. */
      room,
      channel: room.channel,
      onPeerJoin: room.onPeerJoin,
      onPeerLeave: room.onPeerLeave,
      /** cb(sid, visible) when a player's page is hidden or shown. */
      onPeerVisibility: room.onPeerVisibility,
      /** Whether THIS page holds the host role now (it can move: see handoff). */
      isHost: room.isHost,
      /** The host epoch: bumped by the server on every host change. */
      hostEpoch: room.hostEpoch,
      /** cb({ hostId, hostEpoch, previousHostId, reason, isMe, checkpoint }). */
      onHostChange: room.onHostChange,
      /** Host: save the referee state the next host starts from (<= 64 KB). */
      setCheckpoint: room.setCheckpoint,
      /** Host: preferred successors (session ids), in order. */
      setSuccessors: room.setSuccessors,
      /** Host: hand the role to a player now (e.g. before leaving). */
      transferHost: room.transferHost,
      /** Invite link for this table (host side; '' outside a browser). */
      inviteUrl: inviteUrl(code),
      /** Everyone at the table right now, host/self included. A player whose
       *  connection dropped still counts while the server holds their seat. */
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
      /** Host: merge a patch into the table's lobby listing (e.g. status).
       *  Setting `status` yourself takes the open/playing flip over from the
       *  kit (e.g. { status: 'playing' } at kickoff keeps a match closed even
       *  when a seat frees); setting it back to 'open' hands it back. */
      setListing(patch) {
        if (!pub || done) return;
        if (patch && 'status' in patch) {
          status = patch.status;
          kitOwnsStatus = patch.status === 'open';
        }
        pub.update(patch);
      },
      /**
       * Host, pre-game: take the table down cleanly. The listing disappears
       * for everyone and no later joiner can resurrect the abandoned match.
       */
      cancel: takeDown,
      /** Leave the table (host leaving also delists it). */
      leave: takeDown,
    };

    // Keep the listing's status in step with the seat count: 'playing' the
    // moment the table fills (browsers/quick-match stop steering joiners in,
    // joinByCode rejects as 'full'), 'open' again when a seat frees (a player
    // left cleanly, or a dropped player's seat hold ran out) - otherwise a
    // full table that loses a player can never be rejoined. Only while the
    // kit owns the status: an app's own setListing({ status }) wins.
    // Only the page publishing the listing (the host) drives it.
    const sync = () => {
      if (done || !pub || !kitOwnsStatus) return;
      const next = table.players() >= seats ? 'playing' : 'open';
      if (next === status) return;
      status = next;
      pub.update({ status });
    };
    room.onPeerJoin(sync);
    room.onPeerLeave(sync);
    sync();

    // The listing follows the host role: a page that becomes host (handoff or
    // transfer) takes over heart-beating it, so the invite link and code keep
    // working; a page that loses the role stops, without deleting it.
    room.onHostChange(({ isMe }) => {
      if (done) return;
      if (isMe && !pub && dir && listing) {
        pub = dir.publish(code, { ...listing, code, roomId: room.getRoomId(), seats, status });
        rememberHostedTable(code, room.getRoomId());
        sync();
      } else if (!isMe && pub) {
        pub.release();
        pub = null;
        forgetHostedTable();
      }
    });
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

  /** The lobby fields of a directory entry (what a new host republishes). */
  function listingOf(entry) {
    const { _key, lastSeen, ...rest } = entry;
    return rest;
  }

  async function joinEntry(entry, { canHost } = {}) {
    await ensureLobby();
    const joinOpts = canHost ? { canHost: true } : {};
    if (!entry?.roomId) throw new RealtimeJoinError('not-found', 'invalid table entry');
    // Client-side seat gate: a listing that is no longer 'open' means the
    // table filled (or the host closed joins) - reject even when the room's
    // provisioned max_clients would still admit us. The one exception is our
    // own seat: a page that died without a clean leave (and this is its
    // reload) is still seated there, and takes that held seat back.
    if (entry.status && entry.status !== 'open') {
      let room = null;
      try { room = await rt.resume(matchName, { ...joinOpts, roomId: entry.roomId }); } catch { /* not ours to resume */ }
      if (room) return makeTable({ room, code: entry.code, entry, pub: null, listing: listingOf(entry) });
      throw new RealtimeJoinError('full', `table ${entry.code || entry.roomId} is already ${entry.status}`);
    }
    try {
      const room = await rt.joinById(entry.roomId, matchName, joinOpts);
      return makeTable({ room, code: entry.code, entry, pub: null, listing: listingOf(entry) });
    } catch (err) {
      throw toJoinError(err, `joining table ${entry.code || entry.roomId} failed`);
    }
  }

  // The table this browser tab hosts, remembered in sessionStorage so a
  // reloaded host page (the TV of a couch game) resumes the SAME table - same
  // code, same room, players still seated - instead of starting a new one.
  const hostedKey = () => `gipity-rt:hosted-table:${rt.getAppGuid?.() || ''}:${matchName}`;
  function rememberHostedTable(code, roomId) {
    writeStored('sessionStorage', hostedKey(), JSON.stringify({ code, roomId }));
  }
  function forgetHostedTable() { writeStored('sessionStorage', hostedKey(), null); }

  async function resumeHostedTable(info, hostOpts) {
    let saved = null;
    try { saved = JSON.parse(readStored('sessionStorage', hostedKey()) || 'null'); } catch { saved = null; }
    if (!saved?.roomId || !saved?.code || (info.code && info.code.toUpperCase() !== saved.code)) return null;
    let room;
    try {
      room = await rt.joinById(saved.roomId, matchName, hostOpts);
    } catch {
      forgetHostedTable();      // the room is gone: host a fresh table
      return null;
    }
    // The join resolves once the server has announced the host (see transport).
    if (!room.isHost()) {
      room.disconnect();        // someone else holds the table now
      forgetHostedTable();
      return null;
    }
    const pub = dir.publish(saved.code, { ...info, code: saved.code, roomId: room.getRoomId(), seats, status: 'open' });
    return makeTable({ room, code: saved.code, pub, listing: info });
  }

  async function host(options = {}) {
    const { fresh, handoff, graceSeconds, ...info } = options;
    const hostOpts = { host: true };
    if (handoff !== undefined) hostOpts.handoff = !!handoff;
    if (graceSeconds !== undefined) hostOpts.graceSeconds = graceSeconds;
    await ensureLobby();
    // Hosting again while a previous table is still waiting replaces it -
    // otherwise the old room lives on and its listing goes stale-but-joinable.
    if (hostedTable) hostedTable.cancel();
    else if (!fresh) {
      const resumed = await resumeHostedTable(info, hostOpts);
      if (resumed) { hostedTable = resumed; return resumed; }
    }
    const room = await rt.create(matchName, hostOpts);
    let code = String(info.code || '').toUpperCase() || randomCode(codeLength);
    // A fresh entry already using this code gets a re-roll, not a collision.
    while (!info.code && dir.list().some((e) => e.code === code)) code = randomCode(codeLength);
    const pub = dir.publish(code, { ...info, code, roomId: room.getRoomId(), seats, status: 'open' });
    const table = makeTable({ room, code, pub, listing: info });
    hostedTable = table;
    rememberHostedTable(code, room.getRoomId());
    return table;
  }

  async function joinByCode(rawCode, { timeoutMs = 8000, canHost = false } = {}) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code) throw new RealtimeJoinError('not-found', 'no code given');
    await ensureLobby();

    const deadline = Date.now() + timeoutMs;
    const deadRoomIds = new Set();
    while (Date.now() < deadline) {
      const entry = dir.list().find((e) => e.code === code && !deadRoomIds.has(e.roomId));
      if (entry) {
        try {
          return await joinEntry(entry, { canHost });
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
     * Host a table: creates a match room, advertises it under a share code,
     * and holds the room's host role (a TV or big screen hosts, phones join).
     * The role is not a player slot in the game's sense, but the host's page
     * IS a client of the room: it counts toward `seats` and the room's
     * max_clients (a TV + 8 phones needs seats: 9 and max_clients: 9). `info` is merged into the listing
     * (e.g. { host: 'Sam' }); pass `info.code` to force a specific code (e.g. a
     * rematch). Replaces any previous still-waiting hosted table. After a page
     * reload it resumes the same table (same code, players still seated)
     * while the server still holds it; pass `info.fresh` to start a new one.
     * `info.handoff: true` lets the server move the role to a player who
     * joined with { canHost: true } when this page is gone or stops running
     * for `info.graceSeconds` (default: the room's host_grace_seconds, 5).
     * @returns table - share table.code / table.inviteUrl, wire table.onFull,
     *                  and call table.cancel() if the host backs out.
     */
    host,

    /**
     * Join a table by its share code. Waits (default 8s) for the code to
     * appear in the directory - a joiner often clicks faster than the host's
     * entry syncs. opts: { timeoutMs, canHost } (canHost: this page may be
     * handed the host role). Throws RealtimeJoinError: 'not-found' (no such
     * code), 'full' (seats taken / already playing), 'gone' (host left).
     */
    joinByCode,

    /** Join a specific browse-list entry (opts: { canHost }). Throws 'full' / 'gone'. */
    join: joinEntry,

    /**
     * Play against anyone: join the oldest open table, else host a new one.
     * @returns table - check table.isHost() to know which way it went.
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
     * opts: { timeoutMs, canHost } as for joinByCode.
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
