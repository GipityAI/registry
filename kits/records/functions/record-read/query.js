// Safe query builders (list + aggregate). Identifiers come ONLY from the
// registry (whitelist); every value is parameterized. Pure helper: no service access.
import { fieldByName, isQueryableField } from '../_lib/records/registry.js';

const OPS = {
  eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=',
};

// Primary JSONB key per composite type - used for sorting, grouping, and equality filters.
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

// Grouping key: a relation/composite groups by its human-readable primary
// (label / primaryEmail / …); everything else by the raw column.
function groupExpr(object, name) {
  const f = fieldByName(object, name);
  if (f && JSON_PRIMARY[f.type]) return `(${name}->>'${JSON_PRIMARY[f.type]}')`;
  return name;
}

// Summable expression: numeric column, or a currency's amountMicros.
function sumExpr(object, name) {
  const f = fieldByName(object, name);
  if (!f) throw new Error(`Cannot sum unknown field '${name}' of ${object.name}.`);
  if (f.type === 'currency') return `((${name}->>'amountMicros')::numeric)`;
  if (f.type === 'number') return `${name}`;
  throw new Error(`Cannot sum '${name}' (type '${f.type}'); only number and currency fields are summable.`);
}

// Shared WHERE builder: soft-delete guard + registry-validated filters + FTS.
// Returns { whereSql, params }. Used by both list and aggregate so the filter
// semantics never diverge.
function buildWhere(object, { q, filters = [] }) {
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
  return { whereSql: where.join(' AND '), params };
}

export function buildListQuery(object, opts = {}) {
  const { sort, limit = 100, offset = 0 } = opts;
  const { whereSql, params } = buildWhere(object, opts);

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

  return {
    listSql: `SELECT * FROM ${object.table_name} WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    countSql: `SELECT COUNT(*)::int AS total FROM ${object.table_name} WHERE ${whereSql}`,
    params,
  };
}

// Server-side GROUP BY: COUNT(*) per group, plus an optional SUM over a numeric
// or currency field. Honors the same filters/search as list. One query instead
// of paging the whole table into the client (the dashboard pipeline-by-stage
// pattern). `sum` is returned in the field's natural unit - micros for currency.
export function buildAggregateQuery(object, opts = {}) {
  const { group_by, sum } = opts;
  if (!isQueryableField(object, group_by)) {
    throw new Error(`Cannot group by unknown field '${group_by}' of ${object.name}. Valid fields: ${object.fields.map(f => f.name).join(', ')}`);
  }
  const { whereSql, params } = buildWhere(object, opts);
  const g = groupExpr(object, group_by);
  const sumSelect = sum ? `, COALESCE(SUM(${sumExpr(object, sum)}), 0)::numeric AS sum` : '';
  return {
    sql: `SELECT ${g} AS grp, COUNT(*)::int AS count${sumSelect}
          FROM ${object.table_name} WHERE ${whereSql}
          GROUP BY ${g} ORDER BY ${sum ? 'sum' : 'count'} DESC NULLS LAST`,
    params,
  };
}
