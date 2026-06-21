// contacts kit - safe list-query builder for the contacts table. Every value is
// parameterized; sort is whitelisted. FTS via the generated search_vector.

const SORTS = {
  created_at: 'c.created_at',
  updated_at: 'c.updated_at',
  display_name: 'c.display_name',
  score: 'c.score',
};

export function buildListQuery(opts = {}) {
  const { q, tag_id, source, has_email, score_min, score_max, sort, dir, limit = 100, offset = 0 } = opts;
  const where = ['c.deleted_at IS NULL'];
  const params = [];

  if (q) {
    params.push(q);
    where.push(`c.search_vector @@ plainto_tsquery('simple', $${params.length})`);
  }
  if (tag_id) {
    params.push(tag_id);
    where.push(`EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = $${params.length})`);
  }
  if (source) {
    params.push(source);
    where.push(`EXISTS (SELECT 1 FROM contact_sources s WHERE s.contact_id = c.id AND s.source = $${params.length})`);
  }
  if (has_email === true) where.push('c.primary_email IS NOT NULL');
  if (has_email === false) where.push('c.primary_email IS NULL');
  if (Number.isFinite(score_min)) { params.push(score_min); where.push(`c.score >= $${params.length}`); }
  if (Number.isFinite(score_max)) { params.push(score_max); where.push(`c.score <= $${params.length}`); }

  const orderCol = SORTS[sort] || 'c.created_at';
  const orderDir = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
  const whereSql = where.join(' AND ');

  return {
    listSql: `SELECT c.id, c.display_name, c.primary_email, c.score, c.created_at, c.updated_at
              FROM contacts c WHERE ${whereSql}
              ORDER BY ${orderCol} ${orderDir} NULLS LAST LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    countSql: `SELECT COUNT(*)::int AS total FROM contacts c WHERE ${whereSql}`,
    params,
  };
}
