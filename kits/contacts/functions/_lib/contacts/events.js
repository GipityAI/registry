// contacts kit - event spine emission. Called ONLY from inside the single write
// path's transactions, so the spine can never drift from the data. Summaries are
// plain English on purpose - the event stream is prompt-ready and powers the
// activity/job-change feeds.

export async function emitEvent(tx, guid, { objectName, recordId, action, actor, changes = {}, summary }) {
  const text = summary || defaultSummary({ objectName, action, actor, changes });
  await tx.query(
    'INSERT INTO contact_events (id, object_name, record_id, action, actor, changes, summary) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [guid('cev'), objectName, recordId, action, actor || {}, changes, text]
  );
  return text;
}

function who(actor) {
  return actor?.name || actor?.source || 'Someone';
}

function defaultSummary({ objectName, action, actor, changes }) {
  const name = who(actor);
  if (action === 'create') return `${name} added ${objectName}`;
  if (action === 'delete') return `${name} deleted ${objectName}`;
  const keys = Object.keys(changes);
  if (keys.length) {
    const parts = keys.slice(0, 3).map(k => `${k}: ${fmt(changes[k]?.from)} → ${fmt(changes[k]?.to)}`);
    return `${name} updated ${objectName} (${parts.join(', ')})`;
  }
  return `${name} ${action} ${objectName}`;
}

export function fmt(v) {
  if (v === null || v === undefined || v === '') return 'empty';
  if (typeof v === 'object') {
    if (v.company || v.title) return [v.title, v.company].filter(Boolean).join(' at ');
    return JSON.stringify(v);
  }
  return String(v);
}
