# @gipity/agent-api — named API keys for agent writes

Makes a records-kit app **agent-operable**: a named key lets an agent or
script create/update/delete records through the same single write path humans
use — validated against the registry, transactional with the event spine, and
**attributed**: the key's name becomes the ACTOR, so "Gip created note …"
shows up in the same timeline as human edits. Requires the `records` kit.

## What gets installed

- `functions/agent-write/` — public function: `{ api_key, action, object, id, values }`.
  Sealed kit code (re-add to upgrade).
- `migrations/000-kit-agent-api.sql` — the `kit_api_keys` table. **No keys are
  seeded**; mint your own (see the migration's comment).

After adding your app's object tables to `agent-write`'s `tables:` list in
`gipity.yaml` (same as for `record-read`/`record-write`), an agent writes with:

```bash
curl -s -X POST https://a.gipity.ai/api/<PROJECT_GUID>/fn/agent-write \
  -H 'Content-Type: application/json' \
  -d '{"api_key":"<key>","action":"create","object":"note","values":{"title":"Call summary"}}'
```

- `role: readonly` keys are rejected on write (reserved for future read auth).
- `source` (`AGENT` | `API`) controls the ACTOR source recorded on events.
- Revoke a key by setting `revoked_at`; `last_used_at` updates on every write.

Pair it with a generated `llms.txt` + `openapi.json` in your app's `src/` so
agents can discover the API (see the GipCRM reference app).
