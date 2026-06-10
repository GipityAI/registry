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

export function createRecord(object, values) {
  return call('record-write', { action: 'create', object, values });
}

export function updateRecord(object, id, values) {
  return call('record-write', { action: 'update', object, id, values });
}

export function deleteRecord(object, id) {
  return call('record-write', { action: 'delete', object, id });
}
