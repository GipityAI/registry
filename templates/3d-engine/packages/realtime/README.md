# @gipity/realtime

An **engine-agnostic realtime kit** for Gipity apps. One package gives any
app — game, collaborative editor, enterprise dashboard, multiplayer OS — a
known-working realtime layer: transport, channels, presence, party/lobby flows,
host election, server-persisted entity sync, and observability. No 3D /
physics / rendering code.

This package is a **self-describing kit**: it ships its own contract,
schemas, worked examples, reference adapters, and tests so an AI coding agent can
compose the next app from it directly.

```
realtime/
  index.js        createRealtime() entry
  lib/            implementation
  contracts/      the adapter contract (markdown + JSON Schema)
  schemas/        versioned wire-payload schemas
  examples/       one worked file per app shape
  adapters/       reusable reference adapters
  tests/          Node-runnable (gipity sandbox run)
```

## Quick start

```js
import { createRealtime } from '@gipity/realtime';

const rt = createRealtime({ room: 'lobby' });
const chat = rt.channel('chat', { sync: 'messages' });
await rt.connect();

chat.on('msg', (m) => console.log(m.text));
chat.send('msg', { text: 'hello' });
```

## Pick your room model

Four models cover essentially every realtime app. All are built in — pick one,
don't hand-roll:

| Model | Use for | API |
|---|---|---|
| **One shared space** | presence lists, chat, collab docs, dashboards | `createRealtime({ room })` + `connect()` |
| **Spaces from the URL** | per-team / per-session rooms off one link | same, plus `scope: <url param>` |
| **Invite a friend** | 1v1 / private games via share code or link | `createParty()` → `host()` / `joinFromUrl()` / `joinByCode()` |
| **Open lobby** | browse games, quick-match strangers | `createParty()` → `onTables()` / `join(entry)` / `quickMatch()` |

Room *names* must be provisioned (a `realtime` deploy phase in `gipity.yaml`,
or `gipity realtime room create <name>`). Installing this kit provisions a
default room named after the project plus `lobby` and `match`, so all four
models work out of the box.

### Scope: many instances of one provisioned room

`scope` is an opaque partition key: clients with the same `(room, scope)` land
in the same instance; a different scope gets a fresh instance of the same
provisioned room. That's how one app link serves many independent spaces
without provisioning a room per space:

```js
const team = new URLSearchParams(location.search).get('team') || 'general';
const rt = createRealtime({ room: 'standup', scope: team });
```

Never derive the room *name* from a URL — unprovisioned names are rejected by
the server. Derive the **scope**.

### Party: invite links, codes, browse, quick-match

`createParty(rt)` owns the whole "play with a friend / play anyone" flow —
hosting, 4-char share codes, invite URLs, the live table list, and every
failure path (see `examples/party-game.js` for a complete worked shape):

```js
import { createRealtime, createParty } from '@gipity/realtime';
const rt = createRealtime();
const party = createParty(rt, { seats: 2 });      // rooms: 'lobby' + 'match'

// Host - share the link or code; cancel() if the host backs out (the listing
// disappears everywhere; no ghost tables, no resurrected matches).
const table = await party.host({ host: name });
share(table.inviteUrl, table.code);
table.onFull(() => startGame(table));
backButton.onclick = () => table.cancel();

// Guest - the invite link joins on page load (null when there's no ?join=).
const joined = await party.joinFromUrl();

// ...or by typed code / browse list / against anyone:
const t2 = await party.joinByCode(input.value);    // waits up to 8s for sync
const off = await party.onTables(renderList);      // live 'open' entries
const t3 = await party.join(entry);                // from the rendered list
const t4 = await party.quickMatch({ host: name }); // join oldest open, else host
```

Every failed join **throws a `RealtimeJoinError`** — `err.code` is
`'not-found'` (bad/expired code), `'full'` (seats taken / already playing),
`'gone'` (host left), `'unprovisioned'` (the room NAME has no config — a
deploy/provisioning mistake, not a game state), `'auth'`, `'offline'`, or
`'failed'`. Switch on it and show the right message; never leave a spinner on
"Joining…".

The table handle: `isHost`, `code`, `roomId`, `inviteUrl`, `room` (a full room
handle), `channel()`, `players()`, `onFull(cb)` (fires immediately when
already full), `onPeerJoin/onPeerLeave`, `setListing(patch)`, `cancel()`,
`leave()`. When the table fills, its lobby listing flips to
`status: 'playing'` automatically — browsers stop steering joiners into it and
a late `joinByCode` rejects as `'full'` (`seats` is enforced client-side;
provision `match` with a matching `max_clients` for a server-side cap too).
When a seat frees again (a player left, or a dropped player's seat hold ran
out) the listing flips back to `'open'`, so a player who reloads can rejoin
from the invite link or code. That automatic flip stops the moment the app sets
`status` itself with `setListing()` (e.g. `{ status: 'playing' }` at kickoff to
keep a running match closed); setting it back to `'open'` hands it back.
Hosting again while a table is still waiting **replaces** it — the old table
is canceled, never orphaned.

**`seats` counts every client at the table, the host's page included.** The
host is a role, but the page holding it is still a client of the room: a TV
plus 8 phones is `seats: 9`, and the `match` room needs `max_clients: 9`.

`host()` also takes the room's **host role** (server-side): a TV/screen that
hosts a couch game keeps it while phones join as players. After a page reload
the same `party.host()` call **resumes the same table** (same code, players
still seated) while the server holds it (`host_hold_seconds`, default 60);
pass `{ fresh: true }` to start a new one. Phones send to it with
`table.channel('input').sendToHost('press', {...})`. See `examples/couch-controllers.js`.

**Rejoining after a crash.** A phone whose page died *without* a clean leave
(the browser crashed, the OS killed the tab) still has its seat held by the
server for `seat_hold_seconds`. When that browser opens the invite link or
code again, the kit takes the held seat back (same session id), even when the
table is full and even though the listing says `'playing'`. Any other device
waits for the hold to run out (the listing then reopens by itself).

## Rooms (the primitives under all of that)

`createRealtime()` returns a client bound to a **default room** plus the
ability to open more — all sharing one connection and one token:

```js
const rt = createRealtime();
const lobby = await rt.join('lobby');            // joinOrCreate a shared room
const match = await rt.create('match');          // a fresh match instance
const other = await rt.joinById(id, 'match');    // a specific advertised instance
const only  = await rt.joinExisting('match', { scope: code }); // join, NEVER create
const back  = await rt.resume('match', { scope: code }); // take back a held seat, NEVER a new one
const live  = await rt.listRooms('match');       // [{roomId, clients, maxClients, metadata}]
await rt.ensureToken();                          // pre-warm the app token
```

`join` / `joinExisting` / `create` / `joinById` / `resume` **throw
`RealtimeJoinError`** on failure (see above). The default room's `rt.connect()` keeps its
null-on-failure contract (offline mode when the page has no app GUID); inspect
`rt.getLastError()` or the `'error'` event for the cause.

Every room handle has the same surface:

```js
connect(cfg) → room|null        disconnect()
isConnected()                   isSynced()      // first state sync landed?
getRoomId()  getSessionId()     getLastError()
peers() → Map                   onPeerJoin(cb) / onPeerLeave(cb)  // cb(sid)
peerInfo(sid) → { sessionId, clientId, displayName }  // clientId: stable per browser
hostId()  isHost()  onHostChange(cb)   // the server-side host role (join with { host: true })
serverNow()  rtt()  minRtt()  isClockSynced()   // built-in clock sync (__ping)
channel(name, opts)             channels()
on(event, cb)                   metrics()  onMetrics(cb, ms)
getSettings()  applySettings()
```

`onPeerLeave` fires when a peer is gone: immediately on a clean leave (tab
closed or reloaded), and after the seat hold (`seat_hold_seconds`, default
30 s) when a connection dropped and did not come back. A blip inside the hold
never fires it, so it is safe as a forfeit/departure signal without your own
debounce. A page reloaded cleanly is a new session id; match returning players
by `peerInfo(sid).clientId`. A page that died *without* a clean leave keeps
its seat for the hold, and the next join of that room from the same browser
(any mode but `create`) **resumes the held seat** with its old session id,
host role included, instead of being refused as `'full'` by its own ghost
(the resume token lives in localStorage per app, room and scope, and every
clean leave clears it). `rt.resume(name, { scope, roomId })` does only that.

The host key that lets a reloaded host page reclaim the role is kept per tab
(sessionStorage) per app, room and scope, so it works whichever way the host
joined: `join` (joinOrCreate), `joinExisting`, or `joinById`.

**No host?** A `sendToHost()` / `{ to: 'host' }` send while no host is
connected is dropped by the server, which tells the sender: the room fires
`'undelivered'` `{ channel, type, to: 'host', reason: 'no-host' }` (a send to
session ids that are all gone gives `reason: 'no-recipient'`). Delivered and
broadcast messages carry no acknowledgement. `hostId()` is `null` while there
is no host, and `onHostChange(cb)` fires when one arrives, so an app that must
not lose inputs can buffer until then.

Every relayed message carries `senderId` and `serverTs`, stamped by the server
(client values are overwritten, so `senderId` is trustworthy), and
`messages`-channel sends carry `sentAt` in server-clock ms once the clock has
synced: input age on arrival is `room.serverNow() - msg.sentAt`. Limits: 10,000
characters per message or data value, 120 messages/s per client (bursts to
240), 1,000 data keys and 2 MB of data per room.

## Channels

`rt.channel(name, { sync, authority, adapter })` is the **primary API**. One
Colyseus room backs everything; channels namespace by prefixing `name:` onto
every wire key / message type. A channel exposes only its `sync` mode's methods:

### `sync: 'messages'` — pub/sub
`ch.send(type, data, { to })` · `ch.sendToHost(type, data)` · `ch.on(type, cb) → off()` · `ch.metrics()`

`to` is a session id, an array of them, or `'host'`; without it the message
goes to everyone else. Delivery is immediate, reliable, and ordered per sender.

### `sync: 'presence'` — ephemeral per-peer state
`ch.setLocal(obj)` · `ch.local()` · `ch.peers() → Map(sid → peer)` ·
`ch.onChange(cb)` · `ch.onJoin(cb)` · `ch.onLeave(cb)` · `ch.metrics()`

Callback signatures: `onChange` / `onJoin` fire **per peer** as `cb(sid, peer)`;
`onLeave` gets just `cb(sid)`. No callback ever receives the whole roster —
rebuild it from `peers()` (remote peers only) plus `local()` (your own state).
There is **no `set()`** on a presence channel.

Presence rides custom messages at ~20 Hz and is continuously rebroadcast — late
joiners converge with no replay; a crashed peer just goes stale. Presence never
touches the data map.

### `sync: 'entities'` — shared persistent records (CRUD)
`ch.upsert(id, payload)` · `ch.delete(id)` · `ch.get(id)` · `ch.all() → Map` ·
`ch.onUpsert(cb)` · `ch.onDelete(cb)` · `ch.onReady(cb)` · `ch.metrics()`

With `authority: 'host'` the channel adds `isHost()` · `onSynced(cb)` ·
`command(type, data)` · `onCommand(cb)` · `hasReceivedSync()` · `sendFullSync()`.

### `sync: 'store'` — synchronous whole-object key-value
`ch.get(key, fallback)` · `ch.set(key, value)` · `ch.update(key, patch)` ·
`ch.delete(key)` · `ch.has(key)` · `ch.all() → Map` · `ch.entries()` · `ch.keys()` ·
`ch.onChange(cb)` · `ch.onReady(cb)` · `ch.metrics()`

The plain shape a turn-based game, a match, or a lobby directory wants: write a
whole object under a key, read it back synchronously, react to changes. Backed
by the data map (server-persisted, late-join-safe). Last-write-wins by default —
correct for turn-based play; `authority: 'host'` makes one elected peer the
writer and adds `command(type, data)` / `onCommand(cb)` / `isHost()` / `onHost(cb)`.
No adapter needed — values are plain JSON; `set()` **throws** past 10 KB per key.

**Right after `rt.joinById(...)` / `rt.join(...)` the room's state has not arrived yet** — `ch.get(key)` will return `undefined` until the first sync lands. If you need to read state immediately on join (a lobby joiner inspecting the host's match state, say), `await new Promise((r) => ch.onReady(r))` first. `onReady` fires once the first data patch is in the mirror.

## Authority (per `entities` channel) → substrate

| `authority` | Substrate | Notes |
|---|---|---|
| `server` | State-room `data` map | server-persisted, late-join-safe |
| `shared` | State-room `data` map | any peer writes, last-write-wins |
| `host`   | host election + transform delta sync + `entity-op` relay | for simulations / physics |
| `none`   | reserved (no-op) | solo / disabled |

Entity sync is **CRUD-first** (create/update/delete). The `host` mode's
transform delta sync is a delivery optimization for high-frequency movement —
it engages only when the adapter supplies `getDriftAnchor`; without it, `host`
entities simply sync every record each keyframe (for non-spatial host state).
The `store` channel takes the same `authority: 'shared' | 'host'`.

## Adapters

The adapter is **capability-sectioned** and passed per channel — a channel uses
only the section matching its `sync` mode. Payloads stay opaque: the kit
never inspects them.

```
adapter = {
  presence:  { encode, apply, newPeer },
  entities:  { id, encode, decode, apply, remove,        // server/shared
               list, get, clearAll,                       // + host
               serializeFullRow, applyFullRow,
               serializeDeltaRow, applyDeltaRow, getDriftAnchor },
  authority: { hasData, onBecomeHost, onResign },          // host channels
}
```

### The presence adapter contract (most presence apps need NO adapter)

Plain `setLocal(obj)` needs no adapter at all: the object is broadcast as-is
and merged into each remote peer record with an `Object.assign`. Supply
`adapter.presence` only to control the wire format (e.g. quantized positions):

- `encode() → object|null` — local state → wire payload, called every ~50 ms
  (20 Hz). Return `null` to skip a beat; when it returns null the channel falls
  back to whatever `setLocal(obj)` provided.
- `apply(peer, payload)` — merge a received payload into that peer's record
  (default: `Object.assign(peer, payload)`).
- `newPeer() → object` — a blank peer record; the kit stamps `peer.lastSeen`.

The kit adds `sid` to every outgoing payload and drops echoes of your own.
Full machine-readable spec: `contracts/adapter.contract.md` +
`contracts/adapter.schema.json`. Reusable reference adapters live in `adapters/`
(`record-adapter.js` handles any plain-JSON entity channel — whiteboard, Kanban,
agent-ops and desktop all reuse it directly).

## Observability

The runtime is inspectable, not a black box. Events actually emitted:

```js
rt.on('connect',      ({ sessionId, roomId, room, resumed }) => {});
rt.on('synced',       ({ kind }) => {});  // kind: 'create'|'join'|'reconnect'
                                          // -> claim a seat / spectate / re-bind
rt.on('disconnect',   (e) => {});         // intentional leave or permanent loss
rt.on('error',        ({ phase, message, error }) => {});
rt.on('reconnecting', () => {});
rt.on('reconnected',  ({ sessionId }) => {});
rt.on('lost',         () => {});
rt.on('channel-open', ({ name, sync }) => {});
rt.on('undelivered',  ({ channel, type, to, reason }) => {}); // 'no-host' | 'no-recipient'

rt.metrics();            // { connected, peers, channels, messagesSent, ... }
rt.onMetrics((m) => updatePanel(m), 1000);
ch.metrics();            // per-channel counters
```

Host changes are observed **per channel**, not on the room: `ch.onHost(cb)` on
a `store` channel (or `ch.onSynced` / `ch.isHost()` on host-mode `entities`).

## The demo shapes

```js
// 1v1 party game (invite link / code / browse / quick-match)
createParty(rt, { seats: 2 });                    // see examples/party-game.js

// Collaborative whiteboard
rt.channel('cursors', { sync:'presence' });
rt.channel('shapes',  { sync:'entities', authority:'shared', adapter: recordAdapter });
rt.channel('chat',    { sync:'messages' });

// 3D strategy / city-builder
rt.channel('players',   { sync:'presence' });
rt.channel('buildings', { sync:'entities', authority:'host', adapter: physicsAdapter });

// AI agent operations dashboard
rt.channel('agents', { sync:'entities', authority:'server', adapter: recordAdapter });
rt.channel('tasks',  { sync:'entities', authority:'server', adapter: recordAdapter });
rt.channel('logs',   { sync:'messages' });

// Realtime Kanban
rt.channel('cards',    { sync:'entities', authority:'server', adapter: recordAdapter });
rt.channel('presence', { sync:'presence' });

// Multiplayer cloud desktop
rt.channel('windows',  { sync:'entities', authority:'shared', adapter: recordAdapter });
rt.channel('cursors',  { sync:'presence' });
rt.channel('terminal', { sync:'messages' });
```

Each has a worked file in `examples/` (`party-game`, `connect-four`, `lobby`,
`chat-presence`, `whiteboard`, `city-builder`, `agent-ops`, `kanban`, `desktop`).

## Resilience

An unclean disconnect is recovered automatically: the kit retries the Colyseus
reconnection token with exponential backoff inside a window (the server holds a
dropped seat for `seat_hold_seconds`, default 30 s; the host keeps trying for
`hostReconnectWindowMs`, default 55 s, since its role is held for 60 s),
**preserving the session id** — channels and seats survive a blip untouched.
Messages sent while reconnecting are dropped, not queued. A realtime server
restart (a platform deploy) ends every room: clients get `'lost'` and should
re-join. Channel `onDisconnect` handlers fire only on a
permanent loss. Observe it with `rt.on('reconnecting')` · `rt.on('reconnected')`
· `rt.on('lost')`. The initial join is retried too (seat-reservation races), and
the app token is refreshed before it expires (~15 min TTL — long sessions are
covered). All timings tunable via `createRealtime({ settings })` — the full
list with defaults is `DEFAULT_SETTINGS` in `lib/settings.js` (join attempts,
reconnect window/backoff, presence rate, heartbeat, token TTL, quantization).

The flip side of the reconnection hold: when the **page itself dies**
(navigation, tab close), waiting out the seat hold for a reconnect that can never come
would leave a ghost seat — so the kit listens for `pagehide` and leaves
**consented**, freeing the seat (and disposing an empty match room)
immediately. Next joiners never hit "full" because of a closed tab. When the
page dies without `pagehide` firing (a crash, a killed tab), the same browser
resumes its held seat on the next join (see "Rooms").

**Where it runs.** Gipity Realtime runs in one region, US West (Oregon). Every
message makes a round trip through it, so players far from the US West coast
see more latency (typical round trips: about 70 ms from the US East Coast,
about 150 ms from Western Europe, 100-200 ms from East Asia and Australia,
plus each player's own last-mile delay). Fine for party, turn-based and
casual action games; measure with `rt.rtt()` before promising twitch-speed
play overseas.

## Verifying multiplayer actually works

Two clients must be live **at the same time** — sequential checks each see only
themselves and look exactly like a broken app. Use the CLI's concurrent
multi-client mode, which overlaps N real browsers and verifies they coexisted:

```
gipity page test "https://dev.gipity.ai/<acct>/<app>/" --clients 2 --labels Alice,Bob \
  --action "document.querySelector('#name').value='{{label}}'; document.querySelector('form').requestSubmit();" \
  --observe "document.querySelectorAll('.present').length"
```

Do **not** verify with two sequential `page eval` calls, and don't simulate the
second peer inside one page — neither exercises cross-client sync over the real
transport. The kit's own unit tests run under plain Node:
`for t in tests/*.test.js; do node $t; done` (or via `gipity sandbox run`).

## Permissions

Declared in `package.json` → `gipity.permissions`: WebSocket to `rt.gipity.ai`,
a token POST to `a.gipity.ai`, the Colyseus client from `esm.sh`. Installing
the kit provisions three `state`/`public` rooms: one named after the project,
plus `lobby` and `match` for the party flows.
