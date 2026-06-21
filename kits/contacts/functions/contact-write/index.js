// contacts kit - signed-in member write door. Resolves identity to an app member,
// builds the ACTOR, and dispatches to the shared write core. Every branch flows
// through the single write path so the event spine stays complete.
import { ensureMember, assertCanWrite, actorFor } from '../_lib/contacts/members.js';
import {
  updateContact, setPrimary, enrich, setScore, deleteContact,
  createTag, deleteTag, applyTag, removeTag,
  mergeConfirm, mergeReject, mergeUndo,
} from '../_lib/contacts/write-core.js';

export default async function contactWrite(ctx, { db, guid }) {
  const b = ctx.body || {};
  const { action } = b;
  try {
    const member = await ensureMember(db, guid, ctx.auth);
    assertCanWrite(member);
    // Machine writers may declare provenance; humans in the UI are HUMAN.
    const actor = actorFor(member, ['AGENT', 'API', 'IMPORT'].includes(b.source) ? b.source : 'HUMAN');
    const base = { db, guid, actor };

    switch (action) {
      case 'update':       return await updateContact({ ...base, id: b.id, values: b.values });
      case 'set_primary':  return await setPrimary({ ...base, attributeId: b.attribute_id });
      case 'enrich':       return await enrich({ ...base, contactId: b.contact_id, kind: b.kind, value: b.value, value_json: b.value_json, label: b.label, source: b.source });
      case 'score':        return await setScore({ ...base, contactId: b.contact_id, score: b.score });
      case 'delete':       return await deleteContact({ ...base, id: b.id });
      case 'tag_create':   return await createTag({ ...base, label: b.label, color: b.color });
      case 'tag_delete':   return await deleteTag({ ...base, tagId: b.tag_id });
      case 'tag_apply':    return await applyTag({ ...base, contactId: b.contact_id, tagId: b.tag_id, label: b.label, source: b.tag_source });
      case 'tag_remove':   return await removeTag({ ...base, contactId: b.contact_id, tagId: b.tag_id });
      case 'merge_confirm': return await mergeConfirm({ ...base, candidateId: b.candidate_id });
      case 'merge_reject':  return await mergeReject({ ...base, candidateId: b.candidate_id });
      case 'merge_undo':    return await mergeUndo({ ...base, candidateId: b.candidate_id });
      default:
        return { error: `Unknown action '${action}'. Valid: update, set_primary, enrich, score, delete, tag_create, tag_delete, tag_apply, tag_remove, merge_confirm, merge_reject, merge_undo.` };
    }
  } catch (err) {
    return { error: err.message };
  }
}
