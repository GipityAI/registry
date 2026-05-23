# @gipity/realtime

An **engine-agnostic realtime kit** for Gipity apps. One package gives any
app — game, collaborative editor, enterprise dashboard, multiplayer OS — a
known-working realtime layer: transport, channels, presence, host election,
server-persisted entity sync, and observability. No 3D / physics / rendering code.

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

## Rooms

`createRealtime()` returns a client with a **default room** plus the ability to
open more — all sharing one connection and one token:

```js
const rt = createRealtime();
const lobby = await rt.join('lobby');         // shared directory room
const match = await rt.create('match');       // a fresh match instance
const other = await rt.joinById(id, 'match'); // an advertised instance
```

Every room handle has the same surface (`channel`, `peers`, `on`, `getRoomId`).
A single-room app just uses `createRealtime({ room })` + `rt.connect()` and
ignores the rest. `createDirectory(lobby)` turns a shared room into a
heartbeat'd listing of open rooms — see `examples/lobby.js`.

## Channels

`rt.channel(name, { sync, authority, adapter })` is the **primary API**. One
Colyseus room backs everything; channels namespace by prefixing `name:` onto
every wire key / message type. A channel exposes only its `sync` mode's methods:

### `sync: 'messages'` — pub/sub
`ch.send(type, data)` · `ch.on(type, cb) → off()` · `ch.metrics()`

### `sync: 'presence'` — ephemeral per-peer state
`ch.setLocal(obj)` · `ch.local()` · `ch.peers() → Map` ·
`ch.onChange(cb)` · `ch.onJoin(cb)` · `ch.onLeave(cb)` · `ch.metrics()`

Presence rides custom messages at ~20 Hz and is continuously rebroadcast — late
joiners converge with no replay; a crashed peer just goes stale. Presence never
touches the data map.

### `sync: 'entities'` — shared persistent records (CRUD)
`ch.upsert(id, payload)` · `ch.delete(id)` · `ch.get(id)` · `ch.all() → Map` ·
`ch.onUpsert(cb)` · `ch.onDelete(cb)` · `ch.onReady(cb)` · `ch.metrics()`

### `sync: 'store'` — synchronous whole-object key-value
`ch.get(key, fallback)` · `ch.set(key, value)` · `ch.update(key, patch)` ·
`ch.delete(key)` · `ch.has(key)` · `ch.all() → Map` · `ch.onChange(cb)` · `ch.onReady(cb)`

The plain shape a turn-based game, a match, or a lobby directory wants: write a
whole object under a key, read it back synchronously, react to changes. Backed
by the data map (server-persisted, late-join-safe). Last-write-wins by default —
correct for turn-based play; `authority: 'host'` makes one elected peer the
writer and adds `command(type, data)` / `onCommand(cb)` / `isHost()` / `onHost(cb)`.
No adapter needed — values are plain JSON, capped at 10 KB per key.

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

Full machine-readable spec: `contracts/adapter.contract.md` +
`contracts/adapter.schema.json`. Reusable reference adapters live in `adapters/`
(`record-adapter.js` handles any plain-JSON entity channel — whiteboard, Kanban,
agent-ops and desktop all reuse it directly).

## Observability

The runtime is inspectable, not a black box:

```js
rt.on('connect',   (e) => {});
rt.on('disconnect',(e) => {});
rt.on('host-change', () => {});
rt.metrics();            // { connected, peers, channels, messagesSent, ... }
rt.onMetrics((m) => updatePanel(m), 1000);
ch.metrics();            // per-channel counters
```

## The five demo shapes

```js
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

Each has a worked file in `examples/`.

## Resilience

An unclean disconnect is recovered automatically: the kit retries the Colyseus
reconnection token with exponential backoff inside a window (the server holds a
dropped seat for 30 s), **preserving the session id** — channels and seats
survive a blip untouched. Channel `onDisconnect` handlers fire only on a
permanent loss. Observe it with `rt.on('reconnecting')` · `rt.on('reconnected')`
· `rt.on('lost')`. The initial join is retried too (seat-reservation races), and
the app token is refreshed before it expires. All tunable via `settings`
(see `lib/settings.js`).

## Permissions

Declared in `package.json` → `gipity.permissions`: WebSocket to `rt.gipity.ai`,
a token POST to `a.gipity.ai`, the Colyseus client from `esm.sh`. Room type
`state`, auth `public`.
