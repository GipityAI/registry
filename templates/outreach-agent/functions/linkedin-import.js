// Import contacts in batches (sent from the browser) - LinkedIn connections export
// rows or a pasted CSV. Emailed rows -> candidates (status 'to_qualify'); rows with
// no email -> status 'no_email' (scored, in the funnel, never sequenced).
import { fitFromTitle } from './_lib/score.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function norm(r) {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || (r.name || '').trim() || null;
    const email = String(r.email || r.email_address || '').trim().toLowerCase();
    const url = String(r.url || r.linkedin_url || r.profile_url || '').trim() || null;
    const company = (r.company || r.organization || '').trim() || null;
    const title = (r.position || r.title || r.role || '').trim() || null;
    const connected = (r.connected_on || '').trim();
    const notesParts = [];
    if (title && company) notesParts.push(`${title} at ${company}`);
    else if (title || company) notesParts.push(title || company);
    if (connected) notesParts.push(`Connected ${connected}`);
    if (url) notesParts.push(url);
    return {
        name, company,
        title: title ? title.slice(0, 200) : null,
        url: url ? url.slice(0, 300) : null,
        email: EMAIL_RE.test(email) ? email : null,
        notes: notesParts.join(' | ').slice(0, 2000) || null,
        fit: fitFromTitle(title),
    };
}

export default async function linkedinImport(ctx, { db, guid }) {
    const rows = Array.isArray(ctx.body?.rows) ? ctx.body.rows : [];
    if (!rows.length) return { error: 'Provide a non-empty rows array.' };

    const emailed = new Map();   // by email
    const noEmail = new Map();   // by url
    let invalid = 0;
    for (const raw of rows.slice(0, 500)) {
        const r = norm(raw);
        if (r.email) { if (!emailed.has(r.email)) emailed.set(r.email, { id: guid('ct'), ...r }); }
        else if (r.url) { if (!noEmail.has(r.url)) noEmail.set(r.url, { id: guid('ct'), ...r }); }
        else invalid++;
    }

    let added = 0;
    const em = [...emailed.values()];
    if (em.length) {
        const params = [];
        const tuples = em.map((r) => {
            const b = params.length;
            params.push(r.id, r.email, r.name, r.company, r.title, r.url, r.notes, r.fit);
            return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},'linkedin','to_qualify',$${b + 8})`;
        });
        const res = await db.query(
            `INSERT INTO contacts (short_guid,email,name,company,title,linkedin_url,notes,source,status,fit_score)
             VALUES ${tuples.join(',')} ON CONFLICT (email) DO NOTHING`, params);
        added += res.rowCount;
    }
    const ne = [...noEmail.values()];
    if (ne.length) {
        const params = [];
        const tuples = ne.map((r) => {
            const b = params.length;
            params.push(r.id, r.name, r.company, r.title, r.url, r.notes, r.fit);
            return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},'linkedin','no_email',$${b + 7})`;
        });
        const res = await db.query(
            `INSERT INTO contacts (short_guid,name,company,title,linkedin_url,notes,source,status,fit_score)
             VALUES ${tuples.join(',')} ON CONFLICT (linkedin_url) DO NOTHING`, params);
        added += res.rowCount;
    }
    return { added, emailed: em.length, no_email: ne.length, invalid, total: rows.length };
}
