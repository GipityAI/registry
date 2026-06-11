// records kit - read path (public): schema | list | get | events | activity.
// All identifiers resolve through the registry; values are parameterized.
import { loadObject, loadSchema } from '../_lib/records/registry.js';
import { buildListQuery } from './query.js';

export default async function recordRead(ctx, { db }) {
  const { action = 'list' } = ctx.body || {};
  try {
    if (action === 'schema') {
      const objects = await loadSchema(db, ctx.body.app);
      return { objects };
    }

    if (action === 'activity') {
      // Cross-object recent events - the spine as a feed (PLAN.md Bet 3).
      const limit = Math.min(Math.max(parseInt(ctx.body.limit, 10) || 50, 1), 100);
      const { rows: events } = await db.query(
        `SELECT id, object_name, record_id, action, actor, changes, summary, created_at
         FROM kit_events ORDER BY created_at DESC LIMIT ${limit}`
      );
      return { events };
    }

    const object = await loadObject(db, ctx.body.object);

    if (action === 'list') {
      const { listSql, countSql, params } = buildListQuery(object, ctx.body);
      const { rows: records } = await db.query(listSql, params);
      const { rows: [{ total }] } = await db.query(countSql, params);
      return { records: records.map(stripVector), total };
    }

    if (action === 'get') {
      const record = await fetchRecord(db, object, ctx.body.id);
      if (!record) return { error: `No ${object.label} with id '${ctx.body.id}'.` };
      const { rows: events } = await db.query(
        'SELECT id, action, actor, changes, summary, created_at FROM kit_events WHERE object_name = $1 AND record_id = $2 ORDER BY created_at DESC LIMIT 50',
        [object.name, ctx.body.id]
      );
      return { record: stripVector(record), events };
    }

    if (action === 'events') {
      const { rows: events } = await db.query(
        'SELECT id, record_id, action, actor, changes, summary, created_at FROM kit_events WHERE object_name = $1 ORDER BY created_at DESC LIMIT 100',
        [object.name]
      );
      return { events };
    }

    return { error: `Unknown action '${action}'. Valid actions: schema, list, get, events.` };
  } catch (err) {
    return { error: err.message };
  }
}

async function fetchRecord(db, object, id) {
  if (!id) throw new Error(`'id' is required for action get.`);
  const { rows } = await db.query(
    `SELECT * FROM ${object.table_name} WHERE id = $1 AND deleted_at IS NULL`, [id]
  );
  return rows[0] || null;
}

function stripVector(row) {
  const { search_vector, ...rest } = row;
  return rest;
}
