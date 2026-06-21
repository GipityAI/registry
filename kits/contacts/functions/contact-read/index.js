// contacts kit - read path (signed-in). actions: list | get | candidates | tags |
// events. Contacts are PII, so this is auth:user, not public. Identifiers are
// whitelisted; values parameterized.
import { buildListQuery } from './query.js';

export default async function contactRead(ctx, { db }) {
  const b = ctx.body || {};
  const { action = 'list' } = b;
  try {
    if (!ctx.auth?.userGuid) return { error: 'Sign in required.' };

    if (action === 'list') {
      const { listSql, countSql, params } = buildListQuery(b);
      const { rows: contacts } = await db.query(listSql, params);
      const { rows: [{ total }] } = await db.query(countSql, params);
      await decorateList(db, contacts);
      return { contacts, total };
    }

    if (action === 'get') {
      if (!b.id) return { error: "'id' is required." };
      const { rows: [contact] } = await db.query('SELECT * FROM contacts WHERE id = $1', [b.id]);
      if (!contact) return { error: `No contact '${b.id}'.` };
      const { search_vector, ...clean } = contact;
      const [attributes, sources, tags, events] = await Promise.all([
        db.query(`SELECT id, kind, value, value_json, label, source, is_primary, created_at
                  FROM contact_attributes WHERE contact_id = $1 ORDER BY kind, is_primary DESC, created_at`, [b.id]).then(r => r.rows),
        db.query('SELECT id, source, external_id, status, imported_at FROM contact_sources WHERE contact_id = $1 ORDER BY imported_at', [b.id]).then(r => r.rows),
        db.query(`SELECT t.id, t.label, t.color, ct.source FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = $1`, [b.id]).then(r => r.rows),
        db.query('SELECT id, action, actor, changes, summary, created_at FROM contact_events WHERE object_name = $1 AND record_id = $2 ORDER BY created_at DESC LIMIT 100', ['contact', b.id]).then(r => r.rows),
      ]);
      return { contact: clean, attributes, sources, tags, events };
    }

    if (action === 'candidates') {
      const status = b.status || 'pending';
      const limit = Math.min(Math.max(parseInt(b.limit, 10) || 50, 1), 200);
      const { rows } = await db.query(
        `SELECT mc.id, mc.reason, mc.score, mc.evidence, mc.status, mc.created_at,
                mc.contact_id, sc.display_name AS survivor_name, sc.primary_email AS survivor_email,
                mc.candidate_contact_id, cc.display_name AS candidate_name, cc.primary_email AS candidate_email
         FROM merge_candidates mc
         JOIN contacts sc ON sc.id = mc.contact_id
         JOIN contacts cc ON cc.id = mc.candidate_contact_id
         WHERE mc.status = $1 ORDER BY mc.created_at DESC LIMIT ${limit}`,
        [status]
      );
      return { candidates: rows };
    }

    if (action === 'tags') {
      const { rows } = await db.query(
        `SELECT t.id, t.label, t.color, COUNT(ct.contact_id)::int AS count
         FROM tags t LEFT JOIN contact_tags ct ON ct.tag_id = t.id
         GROUP BY t.id ORDER BY t.label`
      );
      return { tags: rows };
    }

    if (action === 'events') {
      const limit = Math.min(Math.max(parseInt(b.limit, 10) || 50, 1), 200);
      const where = ["object_name = 'contact'"];
      const params = [];
      if (b.action_filter) { params.push(b.action_filter); where.push(`action = $${params.length}`); }
      if (b.contact_id) { params.push(b.contact_id); where.push(`record_id = $${params.length}`); }
      const { rows } = await db.query(
        `SELECT id, record_id, action, actor, changes, summary, created_at FROM contact_events
         WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${limit}`, params
      );
      return { events: rows };
    }

    return { error: `Unknown action '${action}'. Valid: list, get, candidates, tags, events.` };
  } catch (err) {
    return { error: err.message };
  }
}

// Attach the primary company and tags for the page of contacts (two batched
// queries, not N+1), so list rows can show company + tags without extra calls.
async function decorateList(db, contacts) {
  if (!contacts.length) return;
  const ids = contacts.map(c => c.id);
  const { rows: comps } = await db.query(
    `SELECT contact_id, value FROM contact_attributes
     WHERE contact_id = ANY($1) AND kind = 'company' AND is_primary`, [ids]);
  const { rows: tags } = await db.query(
    `SELECT ct.contact_id, t.label FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
     WHERE ct.contact_id = ANY($1)`, [ids]);
  const compBy = new Map(comps.map(r => [r.contact_id, r.value]));
  const tagsBy = new Map();
  for (const t of tags) { (tagsBy.get(t.contact_id) || tagsBy.set(t.contact_id, []).get(t.contact_id)).push(t.label); }
  for (const c of contacts) {
    c.primary_company = compBy.get(c.id) || null;
    c.tags = tagsBy.get(c.id) || [];
  }
}
