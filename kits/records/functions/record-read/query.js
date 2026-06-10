// Safe list-query builder. Identifiers come ONLY from the registry (whitelist);
// every value is parameterized. Pure helper: no service access.
import { fieldByName, isQueryableField } from '../_lib/registry.js';

const OPS = {
  eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=',
};

// Primary JSONB key per composite type - used for sorting and equality filters.
const JSON_PRIMARY = {
  relation: 'label',
  emails: 'primaryEmail',
  phones: 'primaryPhone',
  links: 'primaryLinkUrl',
};

// Returns a sortable SQL expression for a field (currency sorts numerically,
// composites sort on their primary value).
function sortExpr(object, name) {
  const f = fieldByName(object, name);
  if (f && f.type === 'currency') return `((${name}->>'amountMicros')::numeric)`;
  if (f && JSON_PRIMARY[f.type]) return `(${name}->>'${JSON_PRIMARY[f.type]}')`;
  return name;
}

// Equality-style filters on a relation match the target's id, not the JSONB blob;
// other composites match their primary value.
function filterExpr(object, name) {
  const f = fieldByName(object, name);
  if (f && f.type === 'relation') return `(${name}->>'id')`;
  if (f && JSON_PRIMARY[f.type]) return `(${name}->>'${JSON_PRIMARY[f.type]}')`;
  return name;
}

export function buildListQuery(object, opts = {}) {
  const { q, filters = [], sort, limit = 100, offset = 0 } = opts;
  const where = ['deleted_at IS NULL'];
  const params = [];

  for (const flt of filters) {
    const { field, op = 'eq', value } = flt || {};
    if (!isQueryableField(object, field)) {
      throw new Error(`Cannot filter on unknown field '${field}' of ${object.name}. Valid fields: ${object.fields.map(f => f.name).join(', ')}`);
    }
    if (op === 'contains') {
      params.push(`%${value}%`);
      where.push(`${field}::text ILIKE $${params.length}`);
    } else if (op === 'in') {
      params.push(Array.isArray(value) ? value : [value]);
      where.push(`${filterExpr(object, field)} = ANY($${params.length})`);
    } else if (op === 'isnull') {
      where.push(`(${field} IS NULL OR ${field}::text = '')`);
    } else if (OPS[op]) {
      params.push(value);
      where.push(`${filterExpr(object, field)} ${OPS[op]} $${params.length}`);
    } else {
      throw new Error(`Unknown filter op '${op}'. Valid ops: ${[...Object.keys(OPS), 'contains', 'in', 'isnull'].join(', ')}`);
    }
  }

  if (q) {
    params.push(q);
    where.push(`search_vector @@ plainto_tsquery('simple', $${params.length})`);
  }

  let orderBy = 'created_at DESC';
  if (sort && sort.field) {
    if (!isQueryableField(object, sort.field)) {
      throw new Error(`Cannot sort on unknown field '${sort.field}' of ${object.name}.`);
    }
    const dir = String(sort.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    orderBy = `${sortExpr(object, sort.field)} ${dir} NULLS LAST`;
  }

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
  const whereSql = where.join(' AND ');

  return {
    listSql: `SELECT * FROM ${object.table_name} WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    countSql: `SELECT COUNT(*)::int AS total FROM ${object.table_name} WHERE ${whereSql}`,
    params,
  };
}
