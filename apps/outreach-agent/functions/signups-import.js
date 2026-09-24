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

// Steve's own team/admin domain - these are internal accounts, never the audience.
const INTERNAL_DOMAIN = '914-6.com';

// Every user auto-gets a 'home' project and an auto-deployed 'monitor' project, so the
// export's app_count is >= 2 for everyone (and Monitor even carries a real deploy
// record). Only projects with OTHER slugs count as something the person actually made.
const AUTO_SLUGS = new Set(['home', 'monitor']);
function realApps(r) {
    return (Array.isArray(r.apps) ? r.apps : [])
        .filter((a) => a && !a.is_default && !AUTO_SLUGS.has(String(a.slug || '').toLowerCase()));
}

// Stage from real signal (contacts.stage stores the funnel stage KEY directly):
//   waitlist row (no account)             -> no_account
//   paying subscriber                     -> paid
//   deployed a real app live              -> deployed
//   created a real project, nothing live  -> created
//   signed up, nothing created            -> signed_up
function stageFor(r) {
    if (r.waitlist) return 'no_account';
    const tier = String(r.subscription_tier || '').trim().toLowerCase();
    if (tier && tier !== 'free') return 'paid';
    const apps = realApps(r);
    if (apps.some((a) => a.deployed)) return 'deployed';
    if (apps.length > 0) return 'created';
    return 'signed_up';
}

// Distil the bundle into durable facts (one row each), source 'platform'.
function knowledgeLines(r) {
    const lines = [];

    // Waitlist rows have no account yet - record only that they asked to get in.
    if (r.waitlist) {
        const since = fmtDate(r.created_at);
        lines.push(`On the Gipity waitlist${since ? ` since ${since}` : ''}: requested access but has not been let in yet.`);
        if (r.geo) {
            const g = [r.geo.city, r.geo.region, r.geo.country].filter(Boolean).join(', ');
            if (g) lines.push(`Location: ${g}.`);
        }
        return lines.map((s) => s.slice(0, 4000));
    }

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

    const apps = realApps(r); // exclude the auto Home + Monitor projects
    const live = apps.filter((a) => a.deployed);
    const names = (list) => list.map((a) => a && a.name).filter(Boolean).slice(0, 8).join(', ');
    if (live.length) {
        lines.push(`Has ${live.length} app(s) deployed live on Gipity: ${names(live)}.`);
        const drafts = apps.filter((a) => !a.deployed);
        if (drafts.length) lines.push(`Also started but not deployed: ${names(drafts)}.`);
    } else if (apps.length) {
        lines.push(`Created ${apps.length} project(s) on Gipity (${names(apps)}) but nothing is deployed live yet.`);
    } else {
        lines.push('Signed up but has not created a project on Gipity yet.');
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
    if (email.endsWith(`@${INTERNAL_DOMAIN}`)) return null; // never import internal/admin accounts
    const name = (r.display_name || '').trim() || email.split('@')[0];
    const stage = stageFor(r);
    return {
        id: guid('ct'),
        email,
        name: name.slice(0, 200),
        account_guid: (r.short_guid || '').trim() ? String(r.short_guid).trim().slice(0, 20) : null,
        stage,
        fit: stage === 'active' ? 85 : 70,
        signup_at: r.created_at || null,
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

    // Resolve the default funnel + its stage keys so each signup lands in a stage.
    // (contacts.stage IS the stage key, so the lookup is direct.)
    const funnel = (await db.query('SELECT short_guid FROM funnels WHERE is_default ORDER BY created_at LIMIT 1')).rows[0];
    const funnelGuid = funnel?.short_guid || null;
    const stageMap = funnelGuid
        ? Object.fromEntries((await db.query(
            'SELECT key, short_guid FROM funnel_stages WHERE funnel_guid=$1', [funnelGuid])).rows.map((r) => [r.key, r.short_guid]))
        : {};
    const stageGuidFor = (stageKey) => stageMap[stageKey] || null;

    // Snapshot current stages BEFORE the upsert so we can detect who ADVANCED - a
    // stage change resets their sequence (fresh, stage-appropriate outreach) and
    // cancels drafts written for the old stage.
    const prior = new Map((await db.query(
        'SELECT email, stage_guid, status FROM contacts WHERE email = ANY($1)',
        [people.map((r) => r.email)])).rows.map((row) => [row.email, row]));

    // Upsert contacts. (xmax = 0) distinguishes a fresh insert from a conflict
    // update so we can report added vs updated. On conflict we refresh the
    // platform-derived fields (name, account_guid, stage, source) and keep the
    // human's edits to everything else. funnel is set only when unset (never moves a
    // manually reassigned contact); stage refreshes only while they're in this funnel.
    const params = [];
    const tuples = people.map((r) => {
        const b = params.length;
        params.push(r.id, r.email, r.name, r.account_guid, r.stage, r.fit, funnelGuid, stageGuidFor(r.stage), r.signup_at);
        return `($${b + 1},$${b + 2},$${b + 3},'gipity','to_qualify',$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`;
    });
    const up = await db.query(
        `INSERT INTO contacts (short_guid,email,name,source,status,account_guid,stage,fit_score,funnel_guid,stage_guid,signup_at)
         VALUES ${tuples.join(',')}
         ON CONFLICT (email) DO UPDATE SET
            name=COALESCE(EXCLUDED.name, contacts.name),
            account_guid=COALESCE(EXCLUDED.account_guid, contacts.account_guid),
            stage=EXCLUDED.stage,
            funnel_guid=COALESCE(contacts.funnel_guid, EXCLUDED.funnel_guid),
            stage_guid=CASE
                WHEN contacts.funnel_guid IS NULL OR contacts.funnel_guid = EXCLUDED.funnel_guid
                THEN EXCLUDED.stage_guid ELSE contacts.stage_guid END,
            signup_at=COALESCE(EXCLUDED.signup_at, contacts.signup_at),
            source='gipity',
            updated_at=NOW()
         RETURNING short_guid, email, (xmax = 0) AS inserted`,
        params);

    const guidByEmail = new Map(up.rows.map((row) => [row.email, row.short_guid]));
    const added = up.rows.filter((row) => row.inserted).length;
    const updated = up.rows.length - added;

    // React to advancement: for contacts whose stage_guid actually changed, restart
    // the touch sequence (the next email speaks to where they are NOW), pull their
    // send mark forward if they were mid-drip, and drop drafts aimed at the old stage.
    const advancedGuids = [];
    for (const r of people) {
        const was = prior.get(r.email);
        if (!was) continue; // fresh insert - nothing to reset
        const newStageGuid = stageGuidFor(r.stage);
        if (newStageGuid && was.stage_guid && was.stage_guid !== newStageGuid) {
            advancedGuids.push(guidByEmail.get(r.email));
        }
    }
    if (advancedGuids.length) {
        await db.query(
            `UPDATE contacts SET seq_step=0, stage_changed_at=NOW(),
                    next_contact_at=CASE WHEN status IN ('new','in_sequence') THEN NOW() ELSE next_contact_at END,
                    updated_at=NOW()
             WHERE short_guid = ANY($1)`, [advancedGuids]);
        await db.query(
            `UPDATE messages SET status='rejected', reject_reason='stage changed before send'
             WHERE contact_guid = ANY($1) AND status IN ('pending_approval','revising','approved')`,
            [advancedGuids]);
    }

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

    // Give any freshly-inserted contacts an unsubscribe token (backfilled for existing
    // ones by migration 003; this covers rows imported after that ran).
    await db.query(
        `UPDATE contacts SET unsub_token = substr(md5(random()::text || short_guid || clock_timestamp()::text), 1, 24)
         WHERE unsub_token IS NULL`);

    return { added, updated, advanced: advancedGuids.length, knowledge_added: knowledgeAdded, invalid, total: rows.length };
}
