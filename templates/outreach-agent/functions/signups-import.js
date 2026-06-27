// Import Gipity platform signups in batches (sent from the browser) - the rows are
// the enrichment bundles the dashboard fetched from the admin /account/accounts
// export. Each becomes a contact (source 'gipity', linked by account_guid) with a
// funnel stage inferred from what they have actually done on Gipity, plus a starter
// knowledge base distilled from the bundle (geo / apps / chats / account age) so the
// draft step has something real to personalize from before any Gmail enrichment.
//
// Mirrors linkedin-import.js, but every signup has an email, so there is no no_email
// bucket - all land as candidates ('to_qualify') for you to qualify before sequencing.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fmtDate(v) {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Stage from real signal: anyone who has shipped an app, or signed in within the
// last two weeks, is 'active'; everyone else who signed up is 'signed_up'.
function stageFor(r) {
    if (Number(r.app_count) > 0) return 'active';
    if (r.last_login_at) {
        const days = (Date.now() - new Date(r.last_login_at).getTime()) / 86_400_000;
        if (days >= 0 && days <= 14) return 'active';
    }
    return 'signed_up';
}

// Distil the bundle into durable facts (one row each), source 'platform'.
function knowledgeLines(r) {
    const lines = [];

    const acct = [];
    const signedUp = fmtDate(r.created_at);
    const lastSeen = fmtDate(r.last_login_at);
    if (signedUp) acct.push(`signed up ${signedUp}`);
    if (lastSeen) acct.push(`last seen ${lastSeen}`);
    if (r.subscription_tier) acct.push(`${r.subscription_tier} tier`);
    if (acct.length) lines.push(`Gipity account: ${acct.join(', ')}.`);

    if (r.geo) {
        const g = [r.geo.city, r.geo.region, r.geo.country].filter(Boolean).join(', ');
        if (g) lines.push(`Location: ${g}.`);
    }

    const apps = Array.isArray(r.apps) ? r.apps : [];
    if (apps.length) {
        const names = apps.map((a) => a && a.name).filter(Boolean).slice(0, 8).join(', ');
        lines.push(`Has built ${r.app_count} app(s) on Gipity${names ? `: ${names}` : ''}.`);
    } else {
        lines.push('Signed up but has not built an app on Gipity yet.');
    }

    const titles = Array.isArray(r.recent_chat_titles) ? r.recent_chat_titles.filter(Boolean) : [];
    if (titles.length) {
        lines.push(`Recently asked the agent to build: ${titles.slice(0, 5).join('; ')}.`);
    }

    return lines.map((s) => s.slice(0, 4000));
}

function norm(r, guid) {
    const email = String(r.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return null;
    const name = (r.display_name || '').trim() || email.split('@')[0];
    const stage = stageFor(r);
    return {
        id: guid('ct'),
        email,
        name: name.slice(0, 200),
        account_guid: (r.short_guid || '').trim() ? String(r.short_guid).trim().slice(0, 20) : null,
        stage,
        fit: stage === 'active' ? 85 : 70,
        knowledge: knowledgeLines(r),
    };
}

export default async function signupsImport(ctx, { db, guid }) {
    const rows = Array.isArray(ctx.body?.rows) ? ctx.body.rows : [];
    if (!rows.length) return { error: 'Provide a non-empty rows array.' };

    // De-dup the incoming batch by email (keep the first occurrence).
    const byEmail = new Map();
    let invalid = 0;
    for (const raw of rows.slice(0, 500)) {
        const r = norm(raw || {}, guid);
        if (!r) { invalid++; continue; }
        if (!byEmail.has(r.email)) byEmail.set(r.email, r);
    }
    const people = [...byEmail.values()];
    if (!people.length) return { added: 0, updated: 0, knowledge_added: 0, invalid, total: rows.length };

    // Upsert contacts. (xmax = 0) distinguishes a fresh insert from a conflict
    // update so we can report added vs updated. On conflict we refresh the
    // platform-derived fields (name, account_guid, stage, source) and keep the
    // human's edits to everything else.
    const params = [];
    const tuples = people.map((r) => {
        const b = params.length;
        params.push(r.id, r.email, r.name, r.account_guid, r.stage, r.fit);
        return `($${b + 1},$${b + 2},$${b + 3},'gipity','to_qualify',$${b + 4},$${b + 5},$${b + 6})`;
    });
    const up = await db.query(
        `INSERT INTO contacts (short_guid,email,name,source,status,account_guid,stage,fit_score)
         VALUES ${tuples.join(',')}
         ON CONFLICT (email) DO UPDATE SET
            name=COALESCE(EXCLUDED.name, contacts.name),
            account_guid=COALESCE(EXCLUDED.account_guid, contacts.account_guid),
            stage=EXCLUDED.stage,
            source='gipity',
            updated_at=NOW()
         RETURNING short_guid, email, (xmax = 0) AS inserted`,
        params);

    const guidByEmail = new Map(up.rows.map((row) => [row.email, row.short_guid]));
    const added = up.rows.filter((row) => row.inserted).length;
    const updated = up.rows.length - added;

    // Seed the knowledge base, deduped against what each contact already has so a
    // re-import never piles up duplicate facts.
    const wanted = [];
    for (const r of people) {
        const cg = guidByEmail.get(r.email);
        if (!cg) continue;
        for (const content of r.knowledge) wanted.push({ contact_guid: cg, content });
    }

    let knowledgeAdded = 0;
    if (wanted.length) {
        const contactGuids = [...new Set(wanted.map((w) => w.contact_guid))];
        const existing = new Set(
            (await db.query(
                'SELECT contact_guid, lower(content) AS c FROM contact_knowledge WHERE contact_guid = ANY($1)',
                [contactGuids])).rows.map((row) => `${row.contact_guid}::${row.c}`));

        const seen = new Set();
        const fresh = [];
        for (const w of wanted) {
            const key = `${w.contact_guid}::${w.content.toLowerCase()}`;
            if (existing.has(key) || seen.has(key)) continue;
            seen.add(key);
            fresh.push(w);
        }
        if (fresh.length) {
            const kp = [];
            const kt = fresh.map((w) => {
                const b = kp.length;
                kp.push(guid('kn'), w.contact_guid, w.content);
                return `($${b + 1},$${b + 2},'platform',$${b + 3})`;
            });
            const kres = await db.query(
                `INSERT INTO contact_knowledge (short_guid, contact_guid, source, content) VALUES ${kt.join(',')}`, kp);
            knowledgeAdded = kres.rowCount;
        }
    }

    return { added, updated, knowledge_added: knowledgeAdded, invalid, total: rows.length };
}
