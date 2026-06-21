// contacts kit - the single write path for member-facing mutations. Every entry
// function (contact-import, contact-write, contact-harvest) delegates here, and
// every mutation emits an event inside the same transaction as the data write so
// the spine can never drift. Pure module: db and guid are injected by the entry.
import { mapRow } from './mappers.js';
import { resolveSource, confirmMerge, rejectMerge, undoMerge, refreshContact } from './resolve.js';
import { emitEvent } from './events.js';

const SERVER_CAP = 500;

// Drive a batch of raw rows through the resolution engine. Each row commits in
// its OWN transaction so one bad row can't roll back the good ones (the CSV
// import pattern), and the caller gets per-row results + aggregate counts.
export async function importRows({ db, guid, actor, source, rows }) {
  if (!Array.isArray(rows) || !rows.length) {
    return { error: 'Provide a non-empty rows array.' };
  }
  if (rows.length > SERVER_CAP) {
    return { error: `Too many rows in one call (${rows.length} > ${SERVER_CAP}); send in chunks of ${SERVER_CAP}.` };
  }
  const results = [];
  const jobChanges = [];
  for (const raw of rows) {
    try {
      const mapped = mapRow(source, raw);
      if (!mapped.attrs.length) {
        results.push({ ok: false, error: 'No usable fields in row.' });
        continue;
      }
      const res = await db.tx((tx) => resolveSource(tx, guid, { source, raw, ...mapped, actor }));
      results.push({
        ok: true, contact_id: res.contact_id, status: res.status,
        ...(res.merge_candidate_id ? { merge_candidate_id: res.merge_candidate_id } : {}),
        ...(res.job_changes.length ? { job_change: true } : {}),
      });
      for (const jc of res.job_changes) jobChanges.push({ contact_id: jc.contact_id, ...jc });
    } catch (err) {
      results.push({ ok: false, error: err.message });
    }
  }
  const by = (s) => results.filter(r => r.ok && r.status === s).length;
  return {
    results,
    created: by('created'),
    folded: by('folded'),
    pending_merge: by('pending_merge'),
    job_changes: jobChanges,
  };
}

// Edit a contact's own columns (display_name, score). Other facts are attributes.
export async function updateContact({ db, guid, actor, id, values }) {
  const allowed = {};
  if (typeof values?.display_name === 'string') allowed.display_name = values.display_name;
  if (values?.score === null || Number.isFinite(values?.score)) allowed.score = values.score;
  if (!Object.keys(allowed).length) return { error: 'Nothing to update (allowed: display_name, score).' };

  const record = await db.tx(async (tx) => {
    const before = await lockContact(tx, id);
    const sets = Object.keys(allowed).map((k, i) => `${k} = $${i + 1}`);
    const params = Object.values(allowed);
    params.push(actor || {}, id);
    const { rows: [row] } = await tx.query(
      `UPDATE contacts SET ${sets.join(', ')}, updated_by = $${params.length - 1}, updated_at = NOW()
       WHERE id = $${params.length} RETURNING *`, params
    );
    const changes = {};
    for (const k of Object.keys(allowed)) changes[k] = { from: before[k], to: allowed[k] };
    await emitEvent(tx, guid, { objectName: 'contact', recordId: id, action: 'update', actor, changes });
    return row;
  });
  return { contact: strip(record) };
}

// Flip which value is the current ("primary") one for its (contact, kind).
export async function setPrimary({ db, guid, actor, attributeId }) {
  return db.tx(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM contact_attributes WHERE id = $1', [attributeId]);
    if (!rows.length) throw new Error(`No attribute '${attributeId}'.`);
    const attr = rows[0];
    await tx.query('UPDATE contact_attributes SET is_primary = FALSE WHERE contact_id = $1 AND kind = $2 AND is_primary',
      [attr.contact_id, attr.kind]);
    await tx.query('UPDATE contact_attributes SET is_primary = TRUE WHERE id = $1', [attributeId]);
    await refreshContact(tx, attr.contact_id, actor);
    await emitEvent(tx, guid, {
      objectName: 'contact', recordId: attr.contact_id, action: 'attribute.set_primary', actor,
      changes: { kind: attr.kind, value: attr.value },
      summary: `Set current ${attr.kind} to "${attr.value}"`,
    });
    const { rows: [contact] } = await tx.query('SELECT * FROM contacts WHERE id = $1', [attr.contact_id]);
    return { contact: strip(contact), attribute: attr };
  });
}

// Attach an enrichment attribute (seniority, company_size, recency, ...) through
// the same spine, attributed to the caller's source (enrichment|app|agent).
export async function enrich({ db, guid, actor, contactId, kind, value, value_json, label, source = 'enrichment' }) {
  if (!kind || (value == null && value_json == null)) return { error: "enrich needs 'kind' and a value." };
  return db.tx(async (tx) => {
    await lockContact(tx, contactId);
    const { rows: ins } = await tx.query(
      `INSERT INTO contact_attributes (id, contact_id, kind, value, value_json, label, source, is_primary, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8)
       ON CONFLICT (contact_id, kind, value) DO UPDATE SET value_json = EXCLUDED.value_json
       RETURNING id`,
      [guid('att'), contactId, kind, String(value ?? ''), value_json || null, label || null, source, actor || {}]
    );
    const attrId = ins[0].id;
    const { rows: prim } = await tx.query(
      'SELECT 1 FROM contact_attributes WHERE contact_id = $1 AND kind = $2 AND is_primary', [contactId, kind]);
    if (!prim.length) await tx.query('UPDATE contact_attributes SET is_primary = TRUE WHERE id = $1', [attrId]);
    await refreshContact(tx, contactId, actor);
    await emitEvent(tx, guid, {
      objectName: 'contact', recordId: contactId, action: 'enriched', actor,
      changes: { kind, value: value ?? value_json, source },
      summary: `Enriched ${kind} (${source})`,
    });
    const { rows: [contact] } = await tx.query('SELECT * FROM contacts WHERE id = $1', [contactId]);
    return { attribute: { id: attrId, kind, value }, contact: strip(contact) };
  });
}

// The kit STORES the score; computing it is the consuming app's policy.
export async function setScore({ db, guid, actor, contactId, score }) {
  if (!Number.isFinite(score)) return { error: "'score' must be a number." };
  return db.tx(async (tx) => {
    const before = await lockContact(tx, contactId);
    await tx.query('UPDATE contacts SET score = $1, updated_by = $2, updated_at = NOW() WHERE id = $3', [score, actor || {}, contactId]);
    await emitEvent(tx, guid, {
      objectName: 'contact', recordId: contactId, action: 'score.set', actor,
      changes: { score: { from: before.score, to: score } }, summary: `Score set to ${score}`,
    });
    const { rows: [contact] } = await tx.query('SELECT * FROM contacts WHERE id = $1', [contactId]);
    return { contact: strip(contact) };
  });
}

export async function deleteContact({ db, guid, actor, id }) {
  return db.tx(async (tx) => {
    await lockContact(tx, id);
    await tx.query('UPDATE contacts SET deleted_at = NOW(), updated_by = $1 WHERE id = $2', [actor || {}, id]);
    await emitEvent(tx, guid, { objectName: 'contact', recordId: id, action: 'delete', actor, summary: 'Contact deleted' });
    return { ok: true };
  });
}

// ---- Tags ---------------------------------------------------------------------

export async function createTag({ db, guid, actor, label, color }) {
  const clean = String(label || '').trim();
  if (!clean) return { error: 'Tag label is required.' };
  return db.tx(async (tx) => {
    const { rows: [tag] } = await tx.query(
      `INSERT INTO tags (id, label, color, created_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (label) DO UPDATE SET color = COALESCE(EXCLUDED.color, tags.color) RETURNING *`,
      [guid('tag'), clean, color || null, actor || {}]
    );
    await emitEvent(tx, guid, { objectName: 'tag', recordId: tag.id, action: 'create', actor, summary: `Tag "${clean}" created` });
    return { tag };
  });
}

export async function deleteTag({ db, guid, actor, tagId }) {
  return db.tx(async (tx) => {
    await tx.query('DELETE FROM tags WHERE id = $1', [tagId]); // contact_tags cascade
    await emitEvent(tx, guid, { objectName: 'tag', recordId: tagId, action: 'delete', actor, summary: 'Tag deleted' });
    return { ok: true };
  });
}

export async function applyTag({ db, guid, actor, contactId, tagId, label, source = 'manual' }) {
  return db.tx(async (tx) => {
    let id = tagId;
    if (!id && label) {
      const { rows: [tag] } = await tx.query(
        `INSERT INTO tags (id, label, created_by) VALUES ($1, $2, $3)
         ON CONFLICT (label) DO UPDATE SET label = EXCLUDED.label RETURNING id`,
        [guid('tag'), String(label).trim(), actor || {}]
      );
      id = tag.id;
    }
    if (!id) throw new Error('Provide tag_id or label.');
    await tx.query(
      `INSERT INTO contact_tags (contact_id, tag_id, source, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [contactId, id, source, actor || {}]
    );
    await emitEvent(tx, guid, { objectName: 'contact', recordId: contactId, action: 'tag.add', actor, changes: { tag_id: id }, summary: 'Tag added' });
    return { ok: true, tag_id: id };
  });
}

export async function removeTag({ db, guid, actor, contactId, tagId }) {
  return db.tx(async (tx) => {
    await tx.query('DELETE FROM contact_tags WHERE contact_id = $1 AND tag_id = $2', [contactId, tagId]);
    await emitEvent(tx, guid, { objectName: 'contact', recordId: contactId, action: 'tag.remove', actor, changes: { tag_id: tagId }, summary: 'Tag removed' });
    return { ok: true };
  });
}

// ---- Merge-review (delegates to the resolution engine, one tx each) -----------

export function mergeConfirm({ db, guid, actor, candidateId }) {
  return db.tx((tx) => confirmMerge(tx, guid, { candidateId, actor }));
}
export function mergeReject({ db, guid, actor, candidateId }) {
  return db.tx((tx) => rejectMerge(tx, guid, { candidateId, actor }));
}
export function mergeUndo({ db, guid, actor, candidateId }) {
  return db.tx((tx) => undoMerge(tx, guid, { candidateId, actor }));
}

async function lockContact(tx, id) {
  if (!id) throw new Error("'contact_id' is required.");
  const { rows } = await tx.query('SELECT * FROM contacts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
  if (!rows.length) throw new Error(`No contact '${id}'.`);
  return rows[0];
}

function strip(row) {
  if (!row) return row;
  const { search_vector, ...rest } = row;
  return rest;
}
