// records kit - THE single write path (PLAN.md Bet 2), shared by every entry
// that mutates records (record-write for signed-in members, agent-write for
// API-key callers). Validate against registry -> resolve relations -> write ->
// emit event, all inside one transaction so the event spine can never drift
// from the data. Pure module: db and guid are passed in by the entry.
import { validateValues } from './validate.js';
import { emitEvent, diffChanges } from './events.js';

export async function performWrite({ db, guid, object, actor, ensureActor, action, id, values, rows, expectUpdatedAt }) {
  // Entries supply either a ready ACTOR (agent-write: an API key, already a row)
  // or an `ensureActor(tx)` that may have to CREATE the actor's backing row
  // (record-write: a first-time member). Resolving on the transaction, as late
  // as possible, is what keeps a rejected write from committing that row - see
  // record-write/membership.js. Everything that can throw before the mutation
  // (validation, staleness, missing record) therefore runs first.
  const resolveActor = ensureActor ?? (async () => actor);

  if (action === 'create') {
    const clean = validateValues(object, values, { isCreate: true });
    const record = await db.tx(async (tx) => insertRecord(tx, guid, object, await resolveActor(tx), clean));
    return { record: strip(record) };
  }

  if (action === 'create_many') {
    if (!Array.isArray(rows)) {
      return { error: "create_many needs 'rows': an array of value objects." };
    }
    const max = maxBatch(object);
    if (rows.length > max) {
      return { error: `create_many accepts at most ${max} rows per call for ${object.name} (per-call query budget); send in chunks of ${max}.` };
    }
    // Each row commits in its OWN transaction, so one bad row doesn't roll back
    // the good ones - per-row results let the caller report partial success
    // (the CSV-import pattern). Validation is per-row and outside the tx.
    const results = [];
    for (const raw of rows) {
      try {
        const clean = validateValues(object, raw, { isCreate: true });
        const record = await db.tx(async (tx) => insertRecord(tx, guid, object, await resolveActor(tx), clean));
        results.push({ ok: true, record: strip(record) });
      } catch (err) {
        results.push({ ok: false, error: err.message });
      }
    }
    return { results, created: results.filter(r => r.ok).length };
  }

  if (action === 'update') {
    const clean = validateValues(object, values, { isCreate: false });
    const result = await db.tx(async (tx) => {
      const before = await lockRecord(tx, object, id);
      assertNotStale(object, before, expectUpdatedAt);
      await resolveRelations(tx, object, clean);
      const changes = diffChanges(object, before, clean);
      // A no-op update writes nothing, so it must not mint an actor row either.
      if (!Object.keys(changes).length) return { record: before, unchanged: true };

      const writeActor = await resolveActor(tx);
      const sets = Object.keys(changes).map((k, i) => `${k} = $${i + 1}`);
      const params = Object.keys(changes).map(k => changes[k].to);
      params.push(writeActor, id);
      const { rows: [row] } = await tx.query(
        `UPDATE ${object.table_name} SET ${sets.join(', ')}, updated_by = $${params.length - 1}, updated_at = NOW()
         WHERE id = $${params.length} RETURNING *`,
        params
      );
      await emitEvent(tx, guid, {
        object, recordId: id, action: 'update', actor: writeActor, changes, title: titleOf(object, row),
      });
      if (changes[object.title_field]) {
        await refreshRelationLabels(tx, object, id, row[object.title_field]);
      }
      return { record: row };
    });
    return result.unchanged
      ? { record: strip(result.record), unchanged: true }
      : { record: strip(result.record) };
  }

  if (action === 'delete') {
    await db.tx(async (tx) => {
      const before = await lockRecord(tx, object, id);
      const writeActor = await resolveActor(tx);
      await tx.query(
        `UPDATE ${object.table_name} SET deleted_at = NOW(), updated_by = $1 WHERE id = $2`,
        [writeActor, id]
      );
      await emitEvent(tx, guid, {
        object, recordId: id, action: 'delete', actor: writeActor, title: titleOf(object, before),
      });
    });
    return { ok: true };
  }

  return { error: `Unknown action '${action}'. Valid actions: create, create_many, update, delete.` };
}

// One record's insert + provenance event, on the caller's transaction. Shared
// by create and create_many so the write path never forks.
async function insertRecord(tx, guid, object, actor, clean) {
  await resolveRelations(tx, object, clean);
  const recordId = guid(object.name.slice(0, 3));
  const cols = ['id', 'created_by', 'updated_by', ...Object.keys(clean)];
  const vals = [recordId, actor, actor, ...Object.values(clean)];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const { rows: [row] } = await tx.query(
    `INSERT INTO ${object.table_name} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    vals
  );
  await emitEvent(tx, guid, {
    object, recordId, action: 'create', actor, title: titleOf(object, row),
  });
  return row;
}

// Largest create_many batch that stays under the function query budget (50).
// Per row: actor(1) + insert(1) + event(1) + 2 per relation field (object lookup
// + existence check, worst case all relations present). The actor query is the
// first-time member's claim, which re-runs on every row's transaction rather
// than memoizing: a row whose tx rolls back after the claim would leave a
// memoized member id pointing at a row that was never committed. It is an
// idempotent upsert, so re-running is cheap and correct - we just budget for it.
// 45 leaves headroom for the entry's own loadObject/resolveMember. The client
// (e.g. CSV import) sizes its chunks from the same object shape, so the cap is
// never actually hit.
function maxBatch(object) {
  const relCount = object.fields.filter(f => f.type === 'relation').length;
  return Math.max(1, Math.floor(45 / (3 + 2 * relCount)));
}

// Relation values arrive as { id }; verify the target exists and denormalize its
// title into { id, label } so lists and events can show it without joins.
// (Trade-off: a renamed target leaves stale labels behind - acceptable at V1,
// revisit when rename frequency matters.)
async function resolveRelations(tx, object, values) {
  for (const field of object.fields) {
    if (field.type !== 'relation' || !(field.name in values) || values[field.name] === null) continue;
    const targetName = field.options?.object;
    const { rows: [target] } = await tx.query(
      'SELECT table_name, label, title_field FROM kit_objects WHERE name = $1', [targetName]
    );
    if (!target) throw new Error(`Field '${field.name}' points at unregistered object '${targetName}'.`);
    const { rows } = await tx.query(
      `SELECT ${target.title_field} AS title FROM ${target.table_name} WHERE id = $1 AND deleted_at IS NULL`,
      [values[field.name].id]
    );
    if (!rows.length) {
      throw new Error(`No ${target.label} with id '${values[field.name].id}' (for field '${field.name}').`);
    }
    values[field.name] = { id: values[field.name].id, label: String(rows[0].title ?? values[field.name].id) };
  }
}

// Optimistic concurrency: a caller that loaded the record can pass its
// updated_at back as expect_updated_at; if someone else changed the record in
// between, the write is rejected with a self-correcting error instead of
// silently last-write-wins (matters for inline cell editing).
function assertNotStale(object, before, expectUpdatedAt) {
  if (!expectUpdatedAt) return;
  const expected = new Date(expectUpdatedAt).getTime();
  const actual = new Date(before.updated_at).getTime();
  if (Number.isFinite(expected) && expected !== actual) {
    const who = before.updated_by?.name || before.updated_by?.source || 'someone else';
    throw new Error(`This ${object.label} changed since you loaded it (last updated by ${who}). Reload the record and retry.`);
  }
}

// When a record's title changes, refresh the denormalized {id,label} copies on
// every relation field that points at this object (the registry knows them
// all - including the polymorphic *_target join objects). Runs inside the same
// transaction as the rename; no events are emitted (denormalization
// maintenance, not a data change).
async function refreshRelationLabels(tx, object, recordId, newTitle) {
  const { rows: refs } = await tx.query(
    `SELECT f.object_name, f.name, o.table_name
     FROM kit_fields f JOIN kit_objects o ON o.name = f.object_name
     WHERE f.type = 'relation' AND f.options->>'object' = $1`,
    [object.name]
  );
  for (const ref of refs) {
    await tx.query(
      `UPDATE ${ref.table_name}
       SET ${ref.name} = jsonb_set(${ref.name}, '{label}', to_jsonb($1::text))
       WHERE ${ref.name}->>'id' = $2 AND deleted_at IS NULL`,
      [String(newTitle ?? recordId), recordId]
    );
  }
}

// FOR UPDATE holds the row for the rest of the transaction, so a concurrent
// update/delete can't slip between this read and our write. A row soft-deleted
// by a concurrent committed transaction fails the deleted_at predicate here and
// surfaces as a clean "No <label> with id" error instead of a half-applied write.
async function lockRecord(tx, object, id) {
  if (!id) throw new Error(`'id' is required for this action.`);
  const { rows } = await tx.query(
    `SELECT * FROM ${object.table_name} WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]
  );
  if (!rows.length) throw new Error(`No ${object.label} with id '${id}'.`);
  return rows[0];
}

function titleOf(object, row) {
  return row[object.title_field] ?? row.id;
}

function strip(row) {
  const { search_vector, ...rest } = row;
  return rest;
}
