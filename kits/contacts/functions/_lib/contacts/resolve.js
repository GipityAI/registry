// contacts kit - THE resolution / merge engine (the core value of the kit).
// Turns raw imported source rows into resolved contacts + folded, keep-all
// attributes with provenance, detects job changes across re-imports, and runs the
// tier-3 merge-review queue. Every public op runs inside a caller-provided
// transaction so data + event spine never drift.
//
// Matching is deterministic and idempotent. Tiers 1-2 (exact email / linkedin_url)
// auto-apply; tier 3 (fuzzy name+company) NEVER auto-merges - it creates an
// independent new contact AND files a merge_candidate for human review. Bias:
// when uncertain, create a new contact rather than risk a wrong merge.
import { emitEvent, fmt } from './events.js';
import { normCompany } from './normalize.js';

const TIER3_THRESHOLD = 0.72;
const JOB_KINDS = new Set(['employment', 'company']);

// Resolve one mapped source row within tx. Returns
// { contact_id, status: 'created'|'folded'|'pending_merge', action, job_changes, merge_candidate_id? }.
export async function resolveSource(tx, guid, { source, externalId, displayName, attrs, raw, actor }) {
  const { sourceId, reimportContactId } = await ingestSource(tx, guid, { source, externalId, raw });

  // Re-import of an already-resolved source: skip matching, fold straight into the
  // known contact (this is the job-change path - new company values land here).
  if (reimportContactId) {
    const job = await foldAndRefresh(tx, guid, reimportContactId, attrs, { source, sourceId, actor });
    return { contact_id: reimportContactId, status: 'folded', action: 'resolve.merge', job_changes: job };
  }

  // Tier 1 + 2: exact-key auto-match.
  const match = await matchExact(tx, attrs);
  if (match) {
    await tx.query('UPDATE contact_sources SET contact_id = $1, status = $2 WHERE id = $3', [match, 'resolved', sourceId]);
    const job = await foldAndRefresh(tx, guid, match, attrs, { source, sourceId, actor });
    await emitEvent(tx, guid, {
      objectName: 'contact', recordId: match, action: 'resolve.merge', actor,
      summary: `${actor?.name || source} matched a ${source} import into an existing contact`,
    });
    return { contact_id: match, status: 'folded', action: 'resolve.merge', job_changes: job };
  }

  // Tier 3: fuzzy name+company -> review queue, never auto-merge.
  const suggestion = await matchFuzzy(tx, attrs);

  // Create an independent new contact either way (zero data loss; usable now).
  const contactId = await createContact(tx, guid, displayName, actor);
  await tx.query('UPDATE contact_sources SET contact_id = $1, status = $2 WHERE id = $3',
    [contactId, suggestion ? 'pending_merge' : 'resolved', sourceId]);
  const job = await foldAndRefresh(tx, guid, contactId, attrs, { source, sourceId, actor });

  if (suggestion) {
    const mcId = guid('mc');
    await tx.query(
      `INSERT INTO merge_candidates (id, contact_id, candidate_contact_id, source_id, reason, score, evidence, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [mcId, suggestion.contactId, contactId, sourceId, 'name_company_fuzzy', suggestion.score, suggestion.evidence, actor]
    );
    await emitEvent(tx, guid, {
      objectName: 'contact', recordId: suggestion.contactId, action: 'merge.suggested', actor,
      changes: { candidate: contactId, score: suggestion.score },
      summary: `Possible duplicate of "${displayName}" suggested for review (score ${suggestion.score.toFixed(2)})`,
    });
    return { contact_id: contactId, status: 'pending_merge', action: 'merge.suggested', job_changes: job, merge_candidate_id: mcId };
  }

  await emitEvent(tx, guid, {
    objectName: 'contact', recordId: contactId, action: 'create', actor,
    summary: `${actor?.name || source} added contact "${displayName}" from ${source}`,
  });
  return { contact_id: contactId, status: 'created', action: 'create', job_changes: job };
}

// Upsert the raw source row. external_id makes re-import idempotent. Returns the
// source row id and, if this was a re-import of an already-resolved row, its contact_id.
async function ingestSource(tx, guid, { source, externalId, raw }) {
  if (externalId) {
    const { rows: [row] } = await tx.query(
      `INSERT INTO contact_sources (id, source, external_id, raw, status)
       VALUES ($1, $2, $3, $4, 'unresolved')
       ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET raw = EXCLUDED.raw, imported_at = NOW()
       RETURNING id, contact_id`,
      [guid('src'), source, externalId, raw || {}]
    );
    return { sourceId: row.id, reimportContactId: row.contact_id || null };
  }
  const { rows: [row] } = await tx.query(
    `INSERT INTO contact_sources (id, source, external_id, raw, status)
     VALUES ($1, $2, NULL, $3, 'unresolved') RETURNING id`,
    [guid('src'), source, raw || {}]
  );
  return { sourceId: row.id, reimportContactId: null };
}

// Tier 1 (email) then tier 2 (linkedin_url): first exact attribute hit on a
// live contact wins. Returns a contact_id or null.
async function matchExact(tx, attrs) {
  for (const kind of ['email', 'linkedin_url']) {
    for (const a of attrs.filter(x => x.kind === kind)) {
      const { rows } = await tx.query(
        `SELECT a.contact_id FROM contact_attributes a
         JOIN contacts c ON c.id = a.contact_id AND c.deleted_at IS NULL
         WHERE a.kind = $1 AND a.value = $2 LIMIT 1`,
        [kind, a.value]
      );
      if (rows.length) return rows[0].contact_id;
    }
  }
  return null;
}

// Tier 3: bucket live contacts by exact normalized name, then discriminate on
// company. Same name + same company -> strong; same name + a missing company ->
// moderate; same name + DIFFERENT company -> likely different people, skip (bias
// to new). Returns { contactId, score, evidence } above threshold, or null.
async function matchFuzzy(tx, attrs) {
  const nameAttr = attrs.find(a => a.kind === 'name');
  if (!nameAttr || !nameAttr.norm_value) return null;
  const incomingCompanies = attrs
    .filter(a => a.kind === 'company' || a.kind === 'employment')
    .map(a => (a.kind === 'company' ? a.norm_value : normCompany(a.value_json?.company || '')))
    .filter(Boolean);

  const { rows: candidates } = await tx.query(
    `SELECT DISTINCT a.contact_id FROM contact_attributes a
     JOIN contacts c ON c.id = a.contact_id AND c.deleted_at IS NULL
     WHERE a.kind = 'name' AND a.norm_value = $1 LIMIT 20`,
    [nameAttr.norm_value]
  );

  let best = null;
  for (const { contact_id } of candidates) {
    const { rows: comps } = await tx.query(
      `SELECT norm_value FROM contact_attributes WHERE contact_id = $1 AND kind = 'company' AND norm_value <> ''`,
      [contact_id]
    );
    const existingCompanies = comps.map(r => r.norm_value);
    const score = scoreCandidate(incomingCompanies, existingCompanies);
    if (score >= TIER3_THRESHOLD && (!best || score > best.score)) {
      best = {
        contactId: contact_id, score,
        evidence: { matched_on: 'name', name: nameAttr.value, incoming_companies: incomingCompanies, existing_companies: existingCompanies },
      };
    }
  }
  return best;
}

// Name already matches exactly (bucket invariant). Company decides confidence.
function scoreCandidate(incoming, existing) {
  if (!incoming.length || !existing.length) return 0.75;        // one side lacks company -> moderate
  const overlap = incoming.some(c => existing.includes(c));
  return overlap ? 0.92 : 0.5;                                  // different companies -> below threshold (skip)
}

async function createContact(tx, guid, displayName, actor) {
  const id = guid('con');
  await tx.query(
    'INSERT INTO contacts (id, display_name, created_by, updated_by) VALUES ($1, $2, $3, $3)',
    [id, displayName || '', actor || {}]
  );
  return id;
}

// Fold every incoming attribute into the contact (keep-all), detect job changes,
// then refresh the contact's denormalized fields once. Returns job_changes[].
async function foldAndRefresh(tx, guid, contactId, attrs, ctx) {
  const jobChanges = [];
  for (const a of attrs) {
    const change = await foldAttribute(tx, guid, contactId, a, ctx);
    if (change) jobChanges.push(change);
  }
  await refreshContact(tx, contactId, ctx.actor);
  return jobChanges;
}

// Insert one attribute value (idempotent on (contact,kind,value)). First value of
// a kind becomes primary silently. A new value that differs from the current
// primary: for job kinds (employment/company) flip primary to freshest + emit
// employment.changed (the lead signal); for other kinds keep both + emit
// attribute.added. Returns a job-change descriptor when one fired, else null.
async function foldAttribute(tx, guid, contactId, a, { source, sourceId, actor }) {
  const { rows: ins } = await tx.query(
    `INSERT INTO contact_attributes (id, contact_id, kind, value, norm_value, value_json, label, source, source_record_id, is_primary, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10)
     ON CONFLICT (contact_id, kind, value) DO NOTHING
     RETURNING id`,
    [guid('att'), contactId, a.kind, a.value, a.norm_value || '', a.value_json || null, a.label || null, source, sourceId || null, actor || {}]
  );
  if (!ins.length) return null; // value already present -> idempotent no-op

  const newId = ins[0].id;
  const { rows: prim } = await tx.query(
    `SELECT id, value, value_json FROM contact_attributes WHERE contact_id = $1 AND kind = $2 AND is_primary = TRUE`,
    [contactId, a.kind]
  );

  if (!prim.length) {
    await tx.query('UPDATE contact_attributes SET is_primary = TRUE WHERE id = $1', [newId]);
    return null; // first value of this kind, no event
  }

  const current = prim[0];
  const differs = attrDiffers(a.kind, current, a);
  if (!differs) return null;

  if (JOB_KINDS.has(a.kind)) {
    // Freshest employment/company wins the "current" flag; the old value is kept.
    await tx.query('UPDATE contact_attributes SET is_primary = FALSE WHERE id = $1', [current.id]);
    await tx.query('UPDATE contact_attributes SET is_primary = TRUE WHERE id = $1', [newId]);
    const from = a.kind === 'employment' ? current.value_json : current.value;
    const to = a.kind === 'employment' ? a.value_json : a.value;
    await emitEvent(tx, guid, {
      objectName: 'contact', recordId: contactId, action: 'employment.changed', actor,
      changes: { kind: a.kind, from, to, source },
      summary: `Job change: ${fmt(from)} → ${fmt(to)} (${source})`,
    });
    return { contact_id: contactId, kind: a.kind, from, to };
  }

  // Non-job kind: keep both, current primary stands.
  await emitEvent(tx, guid, {
    objectName: 'contact', recordId: contactId, action: 'attribute.added', actor,
    changes: { kind: a.kind, value: a.value, source },
    summary: `Added ${a.kind} "${a.value}" (${source})`,
  });
  return null;
}

function attrDiffers(kind, current, incoming) {
  if (kind === 'employment') {
    const c = current.value_json?.company || '';
    const n = incoming.value_json?.company || '';
    return normCompany(c) !== normCompany(n); // a real company change, not a title tweak
  }
  return String(current.value || '') !== String(incoming.value || '');
}

// Recompute the contact's denormalized convenience fields from its attributes:
// primary_email, display_name (only if empty), and the FTS search_text.
async function refreshContact(tx, contactId, actor) {
  await tx.query(
    `UPDATE contacts c SET
       primary_email = (SELECT value FROM contact_attributes WHERE contact_id = c.id AND kind = 'email' AND is_primary LIMIT 1),
       display_name = CASE WHEN c.display_name = '' THEN
         COALESCE((SELECT value FROM contact_attributes WHERE contact_id = c.id AND kind = 'name' AND is_primary LIMIT 1), c.display_name)
         ELSE c.display_name END,
       search_text = COALESCE(
         (SELECT string_agg(DISTINCT value, ' ') FROM contact_attributes
          WHERE contact_id = c.id AND kind IN ('name','company','title','email','location')), ''),
       updated_at = NOW(),
       updated_by = $2
     WHERE c.id = $1`,
    [contactId, actor || {}]
  );
}

// ---- Merge-review resolution (reversible) -------------------------------------

export async function confirmMerge(tx, guid, { candidateId, actor }) {
  const mc = await lockCandidate(tx, candidateId, 'pending');
  const survivor = mc.contact_id;
  const loser = mc.candidate_contact_id;

  // Partition loser's attributes vs the survivor's existing (kind,value) set.
  const { rows: loserAttrs } = await tx.query('SELECT * FROM contact_attributes WHERE contact_id = $1', [loser]);
  const { rows: survAttrs } = await tx.query('SELECT kind, value FROM contact_attributes WHERE contact_id = $1', [survivor]);
  const survSet = new Set(survAttrs.map(r => `${r.kind}::${r.value}`));

  const moved = [];          // attr ids re-pointed to survivor
  const primaryFlips = [];   // moved attr ids that were primary on the loser
  const absorbed = [];       // full snapshots of loser dups deleted (already on survivor)
  for (const at of loserAttrs) {
    if (survSet.has(`${at.kind}::${at.value}`)) {
      absorbed.push(at);
    } else {
      moved.push(at.id);
      if (at.is_primary) primaryFlips.push(at.id);
    }
  }
  if (moved.length) {
    await tx.query('UPDATE contact_attributes SET contact_id = $1, is_primary = FALSE WHERE id = ANY($2)', [survivor, moved]);
  }
  if (absorbed.length) {
    await tx.query('DELETE FROM contact_attributes WHERE id = ANY($1)', [absorbed.map(a => a.id)]);
  }

  // Re-point sources and tags.
  const { rows: srcRows } = await tx.query('SELECT id FROM contact_sources WHERE contact_id = $1', [loser]);
  const sources = srcRows.map(r => r.id);
  if (sources.length) {
    await tx.query("UPDATE contact_sources SET contact_id = $1, status = 'resolved' WHERE id = ANY($2)", [survivor, sources]);
  }
  const { rows: loserTags } = await tx.query('SELECT tag_id FROM contact_tags WHERE contact_id = $1', [loser]);
  const tagsLoser = loserTags.map(r => r.tag_id);
  const { rows: survTagRows } = await tx.query('SELECT tag_id FROM contact_tags WHERE contact_id = $1', [survivor]);
  const survTagSet = new Set(survTagRows.map(r => r.tag_id));
  const tagsAdded = tagsLoser.filter(t => !survTagSet.has(t));
  if (tagsAdded.length) {
    await tx.query(
      `INSERT INTO contact_tags (contact_id, tag_id, source, created_by)
       SELECT $1, tag_id, source, created_by FROM contact_tags WHERE contact_id = $2 AND tag_id = ANY($3)
       ON CONFLICT DO NOTHING`,
      [survivor, loser, tagsAdded]
    );
  }
  await tx.query('DELETE FROM contact_tags WHERE contact_id = $1', [loser]);

  // Soft-delete the loser, pointing back at the survivor (reversible).
  await tx.query('UPDATE contacts SET deleted_at = NOW(), merged_into = $1, updated_by = $2 WHERE id = $3', [survivor, actor || {}, loser]);

  const undo = { loser, moved, primaryFlips, absorbed, sources, tagsAdded, tagsLoser };
  await tx.query(
    `UPDATE merge_candidates SET status = 'confirmed', resolved_by = $1, resolved_at = NOW(),
       evidence = evidence || $2 WHERE id = $3`,
    [actor || {}, { undo }, candidateId]
  );
  await refreshContact(tx, survivor, actor);
  await emitEvent(tx, guid, {
    objectName: 'contact', recordId: survivor, action: 'merge.confirmed', actor,
    changes: { loser, moved: moved.length, absorbed: absorbed.length },
    summary: `${actor?.name || 'Someone'} merged a duplicate into this contact`,
  });
  return { ok: true, survivor, loser };
}

export async function rejectMerge(tx, guid, { candidateId, actor }) {
  const mc = await lockCandidate(tx, candidateId, 'pending');
  await tx.query("UPDATE contact_sources SET status = 'resolved' WHERE contact_id = $1 AND status = 'pending_merge'", [mc.candidate_contact_id]);
  await tx.query("UPDATE merge_candidates SET status = 'rejected', resolved_by = $1, resolved_at = NOW() WHERE id = $2", [actor || {}, candidateId]);
  await emitEvent(tx, guid, {
    objectName: 'contact', recordId: mc.contact_id, action: 'merge.rejected', actor,
    changes: { candidate: mc.candidate_contact_id },
    summary: `${actor?.name || 'Someone'} rejected a suggested merge - both contacts kept`,
  });
  return { ok: true };
}

export async function undoMerge(tx, guid, { candidateId, actor }) {
  const mc = await lockCandidate(tx, candidateId, 'confirmed');
  const undo = mc.evidence?.undo;
  if (!undo) throw new Error('No undo record for this merge.');
  const survivor = mc.contact_id;
  const loser = undo.loser;

  await tx.query('UPDATE contacts SET deleted_at = NULL, merged_into = NULL, updated_by = $1 WHERE id = $2', [actor || {}, loser]);
  if (undo.moved?.length) {
    await tx.query('UPDATE contact_attributes SET contact_id = $1 WHERE id = ANY($2)', [loser, undo.moved]);
  }
  if (undo.primaryFlips?.length) {
    await tx.query('UPDATE contact_attributes SET is_primary = TRUE WHERE id = ANY($1)', [undo.primaryFlips]);
  }
  for (const at of undo.absorbed || []) {
    await tx.query(
      `INSERT INTO contact_attributes (id, contact_id, kind, value, norm_value, value_json, label, source, source_record_id, is_primary, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10, $11) ON CONFLICT DO NOTHING`,
      [at.id, loser, at.kind, at.value, at.norm_value || '', at.value_json || null, at.label || null, at.source, at.source_record_id || null, at.created_by || {}, at.created_at]
    );
  }
  if (undo.sources?.length) {
    await tx.query('UPDATE contact_sources SET contact_id = $1 WHERE id = ANY($2)', [loser, undo.sources]);
  }
  if (undo.tagsAdded?.length) {
    await tx.query('DELETE FROM contact_tags WHERE contact_id = $1 AND tag_id = ANY($2)', [survivor, undo.tagsAdded]);
  }
  for (const t of undo.tagsLoser || []) {
    await tx.query('INSERT INTO contact_tags (contact_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [loser, t]);
  }
  await tx.query("UPDATE merge_candidates SET status = 'undone', resolved_by = $1, resolved_at = NOW() WHERE id = $2", [actor || {}, candidateId]);
  await refreshContact(tx, survivor, actor);
  await refreshContact(tx, loser, actor);
  await emitEvent(tx, guid, {
    objectName: 'contact', recordId: survivor, action: 'merge.undone', actor,
    changes: { restored: loser },
    summary: `${actor?.name || 'Someone'} undid a merge - the duplicate was restored`,
  });
  return { ok: true, restored: loser };
}

async function lockCandidate(tx, candidateId, expectStatus) {
  const { rows } = await tx.query('SELECT * FROM merge_candidates WHERE id = $1 FOR UPDATE', [candidateId]);
  if (!rows.length) throw new Error(`No merge candidate '${candidateId}'.`);
  if (rows[0].status !== expectStatus) {
    throw new Error(`Merge candidate is '${rows[0].status}', expected '${expectStatus}'.`);
  }
  return rows[0];
}

export { refreshContact };
