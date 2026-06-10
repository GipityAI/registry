# @gipity/records — registry-driven generic data plane

Declare your objects and fields **as data**; this kit gives you the rest:
generic CRUD functions, validation with self-correcting errors, full-text
search, soft delete, ACTOR provenance (who/what touched every record - humans
and agents alike), and an **event spine**: every mutation writes the row and an
audit event in one transaction, so the audit log can never drift from the data.

Needs a database — use the `web-fullstack` or `api` template. Pairs with the
`views` kit (registry-driven tables/forms/kanban) and the `agent-api` kit
(named API keys for agent writes).

## What gets installed

- `functions/record-read/`, `functions/record-write/`, `functions/_lib/` — the
  generic read/write functions and shared modules. **Sealed kit code**: don't
  edit; re-adding the kit at a newer version overwrites them (that's the
  upgrade path).
- `migrations/000-kit-records-core.sql` — the registry tables (`kit_objects`,
  `kit_fields`), members (`kit_members`), and the event spine (`kit_events`).
- `src/packages/records/api.js` — the client wrapper (`listRecords`,
  `getRecord`, `createRecord`, …).

## Declare an object (you own these files)

1. Write the object's table + registry rows in a migration (`migrations/00N-myapp.sql`).
   Every object table uses the base-entity pattern — copy this shape:

```sql
CREATE TABLE IF NOT EXISTS assets (
    id            VARCHAR(20) PRIMARY KEY,
    name          TEXT NOT NULL,
    status        VARCHAR(40) NOT NULL DEFAULT 'in_storage',
    price         JSONB,                        -- currency {amountMicros, currencyCode}
    position      REAL NOT NULL DEFAULT 0,
    created_by    JSONB NOT NULL DEFAULT '{}',  -- ACTOR {source, memberId, name}
    updated_by    JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name, ''))) STORED
);
CREATE INDEX IF NOT EXISTS idx_assets_search ON assets USING GIN (search_vector);

INSERT INTO kit_objects (name, table_name, label, label_plural, icon, app, membership, title_field)
VALUES ('asset', 'assets', 'Asset', 'Assets', '📦', 'myapp', 'open', 'name')
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;

INSERT INTO kit_fields (object_name, name, label, type, options, required, in_list, position) VALUES
  ('asset', 'name',   'Name',   'text',     '{}', TRUE, TRUE, 1),
  ('asset', 'status', 'Status', 'select',   '{"values":["in_use","in_storage"]}', TRUE, TRUE, 2),
  ('asset', 'price',  'Price',  'currency', '{}', FALSE, TRUE, 3)
ON CONFLICT (object_name, name) DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, options = EXCLUDED.options,
  required = EXCLUDED.required, in_list = EXCLUDED.in_list, position = EXCLUDED.position;
```

2. Add your table to BOTH functions' `tables:` lists in `gipity.yaml`
   (`record-read` and `record-write`) — the kit ships with only its own core
   tables declared.

3. Deploy. The object is now served by the generic API.

## Field types

`text`, `textarea`, `number`, `boolean`, `date`, `select` (options.values),
`currency` ({amountMicros, currencyCode}; write a plain number of whole units),
`relation` (stored {id, label}; write a record id string — existence is checked
and the label denormalized inside the write transaction; options:
`{"object":"company","labelField":"name"}`), `emails` / `phones` / `links`
(Twenty-style composites; write plain strings), `json` (object).

## Call it

```js
import { listRecords, createRecord } from '@gipity/records';
const { records, total } = await listRecords('asset', {
  q: 'macbook',
  filters: [{ field: 'status', op: 'eq', value: 'in_use' }],
  sort: { field: 'price', dir: 'desc' },
});
```

Relations filter on the target id: `{ field: 'company', op: 'eq', value: '<company id>' }`.

## The one rule

**Never write record tables from anywhere but `record-write` (or the
`agent-api` kit's `agent-write`).** A direct UPDATE bypasses validation and
poisons the event spine. Read-only access from your own functions is fine.
