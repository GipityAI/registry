# @gipity/agent-api — named API keys for agent writes

Makes a records-kit app **agent-operable**: a named key lets an agent or
script create/update/delete records through the same single write path humans
use — validated against the registry, transactional with the event spine, and
**attributed**: the key's name becomes the ACTOR, so "Gip created note …"
shows up in the same timeline as human edits. Requires the `records` kit.

## What gets installed

- `functions/agent-write/` — public function: `{ api_key, action, object, id, values }`.
  Sealed kit code (re-add to upgrade).
- `functions/agent-keys/` — owner-only key management: mint, list, revoke.
  Sealed kit code.
- `migrations/000-kit-agent-api.sql` — the `kit_api_keys` table. **No keys are
  seeded**; mint one with `agent-keys`.

## Mint, list, revoke keys (`agent-keys`)

Owner-only (`auth: user`, caller must hold the records kit's `owner` role).
The secret is returned **once**, at create — store it; `list` shows a 4-char
preview only.

```bash
gipity fn call agent-keys '{"action":"create","name":"laptop-script","source":"AGENT"}'
# -> { "key": { "id": "key_...", "name": "laptop-script", ..., "secret": "<40 chars - shown once>" } }
gipity fn call agent-keys '{"action":"list"}'
gipity fn call agent-keys '{"action":"revoke","id":"key_..."}'
```

From app UI, call it with `Gipity.fn('agent-keys', {...})` as the signed-in
owner. Inside the function, secrets come from the injected `randomToken(chars)`
service (the function runtime has no `crypto` module — `randomToken` is the
sanctioned entropy source).

## Machine writes (`agent-write`)

After adding your app's object tables to `agent-write`'s `tables:` list in
`gipity.yaml` (same as for `record-read`/`record-write`), an agent writes with:

```bash
curl -s -X POST https://a.gipity.ai/api/<PROJECT_GUID>/fn/agent-write \
  -H 'Content-Type: application/json' \
  -d '{"api_key":"<key>","action":"create","object":"note","values":{"title":"Call summary"}}'
```

- `role: readonly` keys are rejected on write (reserved for future read auth).
- `source` (`AGENT` | `API`) controls the ACTOR source recorded on events.
- `last_used_at` updates on every write.

## Provenance: who wrote this record?

Every write stamps an ACTOR onto the record and its `kit_events` row:

```js
created_by / updated_by = { source, memberId, name }
// source: 'MANUAL' (signed-in human) | 'AGENT' | 'API' (this kit's keys)
// name:   the member's display name, or the API key's name
```

So "badge rows by who added them" is `record.created_by.source === 'MANUAL'
? '👤' : '🤖'` with `created_by.name` as the label — no joins needed;
`record-read` returns these fields on every record.

Pair it with a generated `llms.txt` + `openapi.json` in your app's `src/` so
agents can discover the API (see the GipCRM reference app).
