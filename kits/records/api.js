// records kit - client API. Thin wrapper over the generic record functions.
// Kit rule: no app-specific imports in here (sealed kit, see PLAN.md).

async function call(fn, body) {
  const data = await Gipity.fn(fn, body);
  if (data?.error) throw new Error(data.error);
  return data;
}

export function getSchema(app) {
  return call('record-read', { action: 'schema', app });
}

export function listRecords(object, opts = {}) {
  return call('record-read', { action: 'list', object, ...opts });
}

export function getRecord(object, id) {
  return call('record-read', { action: 'get', object, id });
}

// Server-side GROUP BY. opts: { group_by, sum?, filters?, q? }.
// Returns { groups: [{ group, count, sum? }] } (sum in micros for currency).
export function aggregate(object, opts = {}) {
  return call('record-read', { action: 'aggregate', object, ...opts });
}

export function createRecord(object, values, extra = {}) {
  return call('record-write', { action: 'create', object, values, ...extra });
}

export function updateRecord(object, id, values, extra = {}) {
  return call('record-write', { action: 'update', object, id, values, ...extra });
}

export function deleteRecord(object, id) {
  return call('record-write', { action: 'delete', object, id });
}

// Largest create_many batch this object allows in one call - mirrors write-core's
// maxBatch (per row: insert + event + 2 per relation field, under the 45-query
// budget). The client sizes its own chunks from this so the server cap is never
// hit. `objectDef` is a schema object (with .fields).
export function batchSize(objectDef) {
  const relCount = (objectDef.fields || []).filter(f => f.type === 'relation').length;
  return Math.max(1, Math.floor(45 / (2 + 2 * relCount)));
}

// Bulk create through the single write path, auto-chunked to the object's budget.
// `extra` (e.g. { source: 'IMPORT' }) applies to every chunk. onProgress(done,
// total) fires after each chunk. Returns a flat [{ ok, record?, error? }] aligned
// to the input order.
export async function createMany(objectDef, rows, { onProgress, ...extra } = {}) {
  const chunk = batchSize(objectDef);
  const results = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const data = await call('record-write', { action: 'create_many', object: objectDef.name, rows: slice, ...extra });
    results.push(...data.results);
    onProgress?.(Math.min(i + chunk, rows.length), rows.length);
  }
  return results;
}
