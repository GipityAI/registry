// records kit - THE single write path (PLAN.md Bet 2), shared by every entry
// that mutates records (record-write for signed-in members, agent-write for
// API-key callers). Validate against registry -> resolve relations -> write ->
// emit event, all inside one transaction so the event spine can never drift
// from the data. Pure module: db and guid are passed in by the entry.
import { validateValues } from './validate.js';
import { emitEvent, diffChanges } from './events.js';

export async function performWrite({ db, guid, object, actor, action, id, values }) {
  if (action === 'create') {
    const clean = validateValues(object, values, { isCreate: true });
    const recordId = guid(object.name.slice(0, 3));
    const record = await db.tx(async (tx) => {
      await resolveRelations(tx, object, clean);
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
    });
    return { record: strip(record) };
  }

  if (action === 'update') {
    const clean = validateValues(object, values, { isCreate: false });
    const result = await db.tx(async (tx) => {
      const before = await lockRecord(tx, object, id);
      await resolveRelations(tx, object, clean);
      const changes = diffChanges(object, before, clean);
      if (!Object.keys(changes).length) return { record: before, unchanged: true };

      const sets = Object.keys(changes).map((k, i) => `${k} = $${i + 1}`);
      const params = Object.keys(changes).map(k => changes[k].to);
      params.push(actor, id);
      const { rows: [row] } = await tx.query(
        `UPDATE ${object.table_name} SET ${sets.join(', ')}, updated_by = $${params.length - 1}, updated_at = NOW()
         WHERE id = $${params.length} RETURNING *`,
        params
      );
      await emitEvent(tx, guid, {
        object, recordId: id, action: 'update', actor, changes, title: titleOf(object, row),
      });
      return { record: row };
    });
    return result.unchanged
      ? { record: strip(result.record), unchanged: true }
      : { record: strip(result.record) };
  }

  if (action === 'delete') {
    await db.tx(async (tx) => {
      const before = await lockRecord(tx, object, id);
      await tx.query(
        `UPDATE ${object.table_name} SET deleted_at = NOW(), updated_by = $1 WHERE id = $2`,
        [actor, id]
      );
      await emitEvent(tx, guid, {
        object, recordId: id, action: 'delete', actor, title: titleOf(object, before),
      });
    });
    return { ok: true };
  }

  return { error: `Unknown action '${action}'. Valid actions: create, update, delete.` };
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
