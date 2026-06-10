// Event spine emission (PLAN.md Bet 2). Called ONLY from the single write path.
// Summaries are plain English on purpose - the event stream is prompt-ready (Bet 3).

export async function emitEvent(db, guid, { object, recordId, action, actor, changes = {}, title }) {
  const summary = buildSummary({ object, action, actor, changes, title, recordId });
  await db.query(
    'INSERT INTO kit_events (id, object_name, record_id, action, actor, changes, summary) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [guid('evt'), object.name, recordId, action, actor, changes, summary]
  );
  return summary;
}

export function diffChanges(object, before, cleanValues) {
  const changes = {};
  for (const [key, to] of Object.entries(cleanValues)) {
    const from = before[key];
    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) {
      changes[key] = { from: from ?? null, to: to ?? null };
    }
  }
  return changes;
}

function buildSummary({ object, action, actor, changes, title, recordId }) {
  const name = actor.name || actor.source;
  const label = object.label.toLowerCase();
  // Objects whose title_field is 'id' (join rows like task_target) get no
  // quoted title - 'created task link "ttg_x4x2"' reads worse than none.
  const quoted = title && title !== recordId ? `"${title}"` : '';
  if (action === 'create') return `${name} created ${label} ${quoted}`.trim();
  if (action === 'delete') return `${name} deleted ${label} ${quoted}`.trim();
  const parts = Object.entries(changes).slice(0, 3).map(([field, { from, to }]) =>
    `${field}: ${fmt(from)} → ${fmt(to)}`);
  const more = Object.keys(changes).length > 3 ? `, +${Object.keys(changes).length - 3} more` : '';
  return `${name} updated ${label} ${quoted} (${parts.join(', ')}${more})`.trim();
}

function fmt(v) {
  if (v === null || v === undefined || v === '') return 'empty';
  if (typeof v === 'object') {
    if ('amountMicros' in v) return `${(v.amountMicros / 1_000_000).toLocaleString()} ${v.currencyCode || ''}`.trim();
    if ('label' in v && 'id' in v) return v.label || v.id;          // relation
    if ('primaryEmail' in v) return v.primaryEmail || 'empty';      // emails
    if ('primaryPhone' in v) return v.primaryPhone || 'empty';      // phones
    if ('primaryLinkUrl' in v) return v.primaryLinkUrl || 'empty';  // links
    return JSON.stringify(v);
  }
  return String(v);
}
