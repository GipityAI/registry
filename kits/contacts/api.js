// contacts kit - client API. Thin wrapper over the contact functions. Kit rule:
// no app-specific imports here (sealed kit). Re-exports the CSV parsers so the
// import UI can `import { parseLinkedInCSV } from '@gipity/contacts'`.
export { parseCSVRows, parseLinkedInCSV, parseAddressBook, backfillEmails } from './csv.js';

async function call(fn, body) {
  const data = await Gipity.fn(fn, body);
  if (data?.error) throw new Error(data.error);
  return data;
}

// ---- Import ----
// Bulk import for one source, auto-chunked to the server's per-call cap. rows are
// already parsed (e.g. via parseLinkedInCSV). onProgress(done, total) fires per
// chunk. Returns aggregate { results, created, folded, pending_merge, job_changes }.
export async function importContacts(source, rows, { onProgress, chunk = 200 } = {}) {
  const agg = { results: [], created: 0, folded: 0, pending_merge: 0, job_changes: [] };
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const out = await call('contact-import', { source, rows: slice });
    agg.results.push(...(out.results || []));
    agg.created += out.created || 0;
    agg.folded += out.folded || 0;
    agg.pending_merge += out.pending_merge || 0;
    agg.job_changes.push(...(out.job_changes || []));
    onProgress?.(Math.min(i + chunk, rows.length), rows.length);
  }
  return agg;
}

export function saveHarvest(harvest) {
  return call('contact-harvest', { harvest });
}

// ---- Read ----
export function listContacts(opts = {}) { return call('contact-read', { action: 'list', ...opts }); }
export function getContact(id) { return call('contact-read', { action: 'get', id }); }
export function listCandidates(status = 'pending') { return call('contact-read', { action: 'candidates', status }); }
export function listTags() { return call('contact-read', { action: 'tags' }); }
export function listEvents(opts = {}) { return call('contact-read', { action: 'events', ...opts }); }
// Job-change feed: contacts whose company changed across re-imports.
export function jobChanges(opts = {}) { return call('contact-read', { action: 'events', action_filter: 'employment.changed', ...opts }); }

// ---- Write ----
export function updateContact(id, values) { return call('contact-write', { action: 'update', id, values }); }
export function setPrimary(attributeId) { return call('contact-write', { action: 'set_primary', attribute_id: attributeId }); }
export function enrich(contactId, kind, value, extra = {}) { return call('contact-write', { action: 'enrich', contact_id: contactId, kind, value, ...extra }); }
export function setScore(contactId, score) { return call('contact-write', { action: 'score', contact_id: contactId, score }); }
export function deleteContact(id) { return call('contact-write', { action: 'delete', id }); }

export function createTag(label, color) { return call('contact-write', { action: 'tag_create', label, color }); }
export function deleteTag(tagId) { return call('contact-write', { action: 'tag_delete', tag_id: tagId }); }
export function applyTag(contactId, { tagId, label, source } = {}) { return call('contact-write', { action: 'tag_apply', contact_id: contactId, tag_id: tagId, label, tag_source: source }); }
export function removeTag(contactId, tagId) { return call('contact-write', { action: 'tag_remove', contact_id: contactId, tag_id: tagId }); }

export function confirmMerge(candidateId) { return call('contact-write', { action: 'merge_confirm', candidate_id: candidateId }); }
export function rejectMerge(candidateId) { return call('contact-write', { action: 'merge_reject', candidate_id: candidateId }); }
export function undoMerge(candidateId) { return call('contact-write', { action: 'merge_undo', candidate_id: candidateId }); }
