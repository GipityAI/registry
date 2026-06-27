// Contact management: list | get | save | delete
// `get` returns the contact plus its knowledge base and message history so the
// dashboard can show everything about one person on a single screen.
import { isValidCadence, isDormantStatus, clampScore, nextContactDate } from './_lib/cadence.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function contacts(ctx, { db, guid }) {
    const op = ctx.body?.op || 'list';
    if (op === 'list') return listContacts(ctx, db);
    if (op === 'get') return getContact(ctx, db);
    if (op === 'save') return saveContact(ctx, db, guid);
    if (op === 'delete') return deleteContact(ctx, db);
    if (op === 'due_now') return dueNow(ctx, db);
    return { error: `Unknown op: ${op}` };
}

// Make a sequenced contact due right now so the next draft run picks them up.
async function dueNow(ctx, db) {
    const id = ctx.body?.contact_guid;
    if (!id) return { error: 'contact_guid required' };
    const { rows } = await db.query(
        `UPDATE contacts SET next_contact_at=NOW(), updated_at=NOW()
         WHERE short_guid=$1 AND status IN ('new','in_sequence') RETURNING short_guid`, [id]);
    if (!rows.length) return { error: 'Contact is not in an active sending state.' };
    return { ok: true };
}

async function listContacts(ctx, db) {
    const { status, q, due_only } = ctx.body || {};
    const where = [];
    const params = [];
    if (status) { params.push(status); where.push(`status = $${params.length}`); }
    if (q) {
        params.push(`%${q}%`);
        where.push(`(email ILIKE $${params.length} OR name ILIKE $${params.length} OR company ILIKE $${params.length})`);
    }
    if (due_only) {
        where.push(`status IN ('new','in_sequence') AND next_contact_at IS NOT NULL AND next_contact_at <= NOW()`);
    }
    const sql = `SELECT * FROM contacts ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY (fit_score + engagement_score) DESC, next_contact_at ASC NULLS LAST, created_at DESC
                 LIMIT 500`;
    const { rows } = await db.query(sql, params);
    return { contacts: rows, now: new Date().toISOString() };
}

async function getContact(ctx, db) {
    const id = ctx.body?.contact_guid;
    if (!id) return { error: 'contact_guid required' };
    const contact = await db.findOne('contacts', { short_guid: id });
    if (!contact) return { error: 'Contact not found' };
    const { rows: knowledge } = await db.query(
        'SELECT * FROM contact_knowledge WHERE contact_guid=$1 ORDER BY created_at DESC', [id]);
    const { rows: messages } = await db.query(
        'SELECT * FROM messages WHERE contact_guid=$1 ORDER BY created_at DESC', [id]);
    return { contact, knowledge, messages, now: new Date().toISOString() };
}

// Re-entering the sequence (new contact, or status moved back to new) restarts the
// touch sequence and makes them due now. Dormant statuses are never scheduled.
function nextOnSave(status, cadence, restart, existingNext) {
    if (isDormantStatus(status)) return null;
    if (restart || !existingNext) return new Date().toISOString();
    return existingNext;
}

async function saveContact(ctx, db, guid) {
    const b = ctx.body || {};
    const email = (b.email || '').trim().toLowerCase() || null;
    if (email && !EMAIL_RE.test(email)) return { error: 'Email is not valid.' };
    const status = b.status || 'new';
    const cadence = isValidCadence(b.cadence) ? b.cadence : 'every3';
    const name = b.name || null;
    const company = b.company || null;
    const title = b.title || null;
    const notes = b.notes || null;
    const source = b.source || 'manual';
    const fit = b.fit_score != null ? clampScore(b.fit_score) : null;
    // Stage/persona are funnel segmentation; null leaves the stored value untouched.
    const STAGES = ['cold', 'signed_up', 'active'];
    const PERSONAS = ['investor', 'developer', 'designer', 'games', 'enterprise', 'unknown'];
    const stage = STAGES.includes(b.stage) ? b.stage : null;
    const persona = PERSONAS.includes(b.persona) ? b.persona : null;

    if (b.short_guid) {
        const existing = await db.findOne('contacts', { short_guid: b.short_guid });
        if (!existing) return { error: 'Contact not found' };
        // Restart the sequence if they were re-activated from a non-sending state.
        const restart = isDormantStatus(existing.status) && !isDormantStatus(status);
        const next = nextOnSave(status, cadence, restart, existing.next_contact_at);
        const seqStep = restart ? 0 : existing.seq_step;
        const { rows } = await db.query(
            `UPDATE contacts SET email=$2, name=$3, company=$4, title=$5, status=$6, cadence=$7,
                    notes=$8, next_contact_at=$9, seq_step=$10, fit_score=COALESCE($11, fit_score),
                    stage=COALESCE($12, stage), persona=COALESCE($13, persona), updated_at=NOW()
             WHERE short_guid=$1 RETURNING *`,
            [b.short_guid, email, name, company, title, status, cadence, notes, next, seqStep, fit, stage, persona]);
        return { contact: rows[0] };
    }

    const id = guid('ct');
    const next = nextOnSave(status, cadence, true, null);
    const { rows } = await db.query(
        `INSERT INTO contacts (short_guid, email, name, company, title, source, status, cadence, notes, next_contact_at, fit_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (email) DO UPDATE
            SET name=COALESCE(EXCLUDED.name, contacts.name),
                company=COALESCE(EXCLUDED.company, contacts.company),
                notes=COALESCE(EXCLUDED.notes, contacts.notes),
                updated_at=NOW()
         RETURNING *`,
        [id, email, name, company, title, source, status, cadence, notes, next, fit ?? 50]);
    return { contact: rows[0] };
}

async function deleteContact(ctx, db) {
    const id = ctx.body?.contact_guid;
    if (!id) return { error: 'contact_guid required' };
    const res = await db.query('DELETE FROM contacts WHERE short_guid=$1', [id]);
    return { deleted: res.rowCount };
}
