# Adapter contract — `@gipity/realtime`

An **adapter** is the only place app-specific knowledge lives. The kit
never inspects a presence payload or an entity record — it moves bytes and
calls the adapter. Adapters are **capability-sectioned**; a channel uses only
the section matching its `sync` mode, so an app implements just what it needs.

`normalizeAdapter()` fills every missing method with a safe no-op
(`lib/context.js`), so partial adapters are always valid.

```
adapter = { presence?, entities?, authority? }
```

A `messages` channel and a `store` channel take **no adapter** — `messages`
moves opaque payloads, `store` moves plain JSON. Adapters exist only for
`presence` and `entities`.

## `presence` — used by `sync: 'presence'` channels

| Method | Signature | Purpose |
|---|---|---|
| `encode()` | `() → object\|null` | Local state as a wire payload. Called ~20 Hz. `null` skips the broadcast. If omitted, the channel broadcasts whatever `ch.setLocal(obj)` was given. |
| `apply(peer, payload)` | `(record, object) → void` | Merge a received payload into a peer record. |
| `newPeer()` | `() → object` | A blank peer record (the channel fills `lastSeen`). |

## `entities` — used by `sync: 'entities'` channels

Server/shared subset (data-map backed):

| Method | Signature | Purpose |
|---|---|---|
| `id(entity)` | `(entity) → string` | Stable id. |
| `encode(record)` | `(record) → jsonable` | Record → wire value. |
| `decode(value)` | `(jsonable) → record` | Wire value → record. |
| `apply(id, record, prev)` | `→ void` | App-side reaction to an upsert (optional — most apps use `ch.onUpsert`). |
| `remove(id)` | `→ void` | App-side reaction to a delete (optional — most use `ch.onDelete`). |

Host subset (adds, for `authority: 'host'` simulations):

| Method | Signature | Purpose |
|---|---|---|
| `list()` | `() → iterable` | All entities. |
| `get(id)` | `(string) → entity\|null` | Look up one. |
| `clearAll()` | `() → void` | Drop all before applying a full sync. |
| `serializeFullRow(entity)` | `→ array` | Full wire row (`row[0]` MUST be the id). |
| `applyFullRow(row)` | `→ void` | Recreate an entity from a full row. |
| `getDriftAnchor(entity)` *(optional)* | `→ {x,y,z}\|null` | Physics only. Supplied → host sync does delta + drift correction; `null` for one entity excludes it. **Omitted entirely → the host syncs every row each keyframe** — the mode for non-spatial host state (a turn / real-time game with no `{x,y,z}`). |
| `serializeDeltaRow(entity)` | `→ array` | Compact wire row for a moved entity. |
| `applyDeltaRow(row)` | `→ number` | Apply a delta row; return the drift distance. |

## `authority` — used by `authority: 'host'` channels

| Method | Signature | Purpose |
|---|---|---|
| `hasData()` | `() → boolean` | Does this client hold authoritative state? (election tiebreak) |
| `onBecomeHost()` | `() → void` | This client became host. |
| `onResign()` | `() → void` | This client stopped being host. |

## Rules

- Payloads are **opaque** to the kit — return whatever JSON-serializable
  shape (record or compact array) you like; only `entity` rows must carry the
  id at `row[0]`.
- Authority (`isHost`) is owned by the kit — adapters never decide it.
- See `adapter.schema.json` for the machine-readable structure and
  `../examples/` for worked adapters per app shape.
