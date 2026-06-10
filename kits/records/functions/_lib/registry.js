// Registry loader - shared shape for read & UI. Pure helper: db passed in.

// Base-entity columns every object has (valid for sort/filter, not in kit_fields).
export const BASE_FIELDS = ['id', 'created_at', 'updated_at', 'position'];

export async function loadObject(db, objectName) {
  const { rows } = await db.query('SELECT * FROM kit_objects WHERE name = $1', [objectName]);
  if (!rows.length) {
    const { rows: all } = await db.query('SELECT name FROM kit_objects ORDER BY name');
    throw new Error(`Unknown object '${objectName}'. Valid objects: ${all.map(r => r.name).join(', ') || '(none registered)'}`);
  }
  const object = rows[0];
  const { rows: fields } = await db.query(
    'SELECT name, label, type, options, required, in_list, position FROM kit_fields WHERE object_name = $1 ORDER BY position',
    [objectName]
  );
  return { ...object, fields };
}

export async function loadSchema(db, app) {
  const params = [];
  let where = '';
  if (app) { where = 'WHERE app = $1'; params.push(app); }
  const { rows: objects } = await db.query(`SELECT * FROM kit_objects ${where} ORDER BY name`, params);
  const { rows: fields } = await db.query(
    'SELECT object_name, name, label, type, options, required, in_list, position FROM kit_fields ORDER BY object_name, position'
  );
  return objects.map(o => ({ ...o, fields: fields.filter(f => f.object_name === o.name) }));
}

export function fieldByName(object, name) {
  return object.fields.find(f => f.name === name) || null;
}

export function isQueryableField(object, name) {
  return BASE_FIELDS.includes(name) || !!fieldByName(object, name);
}
