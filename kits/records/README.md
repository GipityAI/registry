# @gipity/records — registry-driven generic data plane

Declare your objects and fields **as data**; this kit gives you the rest:
generic CRUD functions, validation with self-correcting errors, full-text
search, soft delete, ACTOR provenance (who/what touched every record - humans
and agents alike), and an **event spine**: every mutation writes the row and an
audit event in one transaction, so the audit log can never drift from the data.

Needs a database — use the `web-fullstack` or `api` template. Pairs with the
`views` kit (registry-driven tables/forms/kanban) and the `agent-api` kit
(named API keys for agent writes).

## ⚠️ The read path is PUBLIC by default

`record-read` ships at `auth: "public"` (writes are gated at `auth: "user"`).
That means **anyone who knows your app's id can read every row of every object**
— including composite PII fields (emails/phones/links), the full schema, and the
audit/activity log with actor names — with no sign-in. That's convenient for a
public directory or demo, but it's the wrong default for anything private
(contacts, deals, anything CRM-shaped).

Before you ship private data, change `record-read`'s `auth` in the kit's
`package.json` install block (or your app's `gipity.yaml`) to `"user"` or
`"member"`, and add row-level RBAC policies so a signed-in caller only sees
their own rows. Treat the public default as opt-in, not a given.

## What gets installed

- `functions/record-read/`, `functions/record-write/`, `functions/_lib/records/` — the
  generic read/write functions and shared modules (namespaced under `_lib/records/`
  so they never collide with your app's own `_lib` files). **Sealed kit code**: don't
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
import { listRecords, aggregate, createMany, getSchema } from '@gipity/records';

const { records, total } = await listRecords('asset', {
  q: 'macbook',
  filters: [{ field: 'status', op: 'eq', value: 'in_use' }],
  sort: { field: 'price', dir: 'desc' },
});

// Server-side GROUP BY - count + optional sum, one query, no client paging.
// sum is in micros for a currency field. Honors the same filters/q as list.
const { groups } = await aggregate('opportunity', { group_by: 'stage', sum: 'amount' });
// → [{ group: 'won', count: 5, sum: 1525000000000 }, …]

// Bulk create through the single write path, auto-chunked to the query budget.
// Returns a flat [{ ok, record? , error? }] in input order; one bad row doesn't
// sink the others. The objectDef is a schema object (with .fields).
const { objects } = await getSchema('myapp');
const asset = objects.find(o => o.name === 'asset');
const results = await createMany(asset, rowsFromCsv, { source: 'IMPORT', onProgress });
```

Relations filter on the target id: `{ field: 'company', op: 'eq', value: '<company id>' }`.

## Concurrency and provenance

- **Optimistic concurrency**: pass `expect_updated_at` (the record's `updated_at`
  you loaded) with an update - if someone changed the record in between, you get
  a clean "changed since you loaded it" error instead of silent last-write-wins.
- **Label refresh**: renaming a record updates the denormalized `{id, label}` on
  every relation that points at it, inside the same transaction. **Bound:** the
  refresh is one `UPDATE` per referencing table, subject to the function's
  `max_rows_affected` (1,000). Renaming a record referenced by >1,000 live rows
  in a single table will fail the rename; raise the limit on `record-write` or
  reconcile labels out of band if you expect fan-out that large.
- **Import provenance**: `record-write` accepts `source: "IMPORT"` for bulk paths
  (CSV import) so events read "imported", not "created", on the timeline.
- **Bulk create**: `create_many` (via `createMany`) runs each row in its own
  transaction - per-row results, partial success on error. The client chunks to
  the object's `batchSize` automatically; `agent-write` accepts it too.

## The one rule

**Never write record tables from anywhere but `record-write` (or the
`agent-api` kit's `agent-write`).** A direct UPDATE bypasses validation and
poisons the event spine. Read-only access from your own functions is fine.
