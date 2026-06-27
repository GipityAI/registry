import { api } from '../api.js';
import { el, setStatus, toast } from '../util.js';

// Minimal CSV parser (handles quoted fields + commas/newlines inside quotes).
function parseCsv(text) {
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) {
            if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (ch === '"') q = false;
            else field += ch;
        } else if (ch === '"') q = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.some((c) => c.trim() !== '')) rows.push(row);
            row = [];
        } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); if (row.some((c) => c.trim() !== '')) rows.push(row); }
    return rows;
}

const KEYMAP = {
    'first name': 'first_name', 'last name': 'last_name', 'name': 'name',
    'email address': 'email', 'email': 'email', 'e-mail address': 'email',
    'company': 'company', 'organization': 'company',
    'position': 'position', 'title': 'title', 'job title': 'title',
    'url': 'url', 'profile url': 'url', 'linkedin': 'url',
    'connected on': 'connected_on',
};

function toRows(csv) {
    const grid = parseCsv(csv);
    // LinkedIn's Connections.csv has a few "Notes:" lines before the header; find the header.
    let h = grid.findIndex((r) => r.map((c) => c.toLowerCase().trim()).some((c) => c === 'first name' || c === 'email address' || c === 'email'));
    if (h === -1) h = 0;
    const header = grid[h].map((c) => KEYMAP[c.toLowerCase().trim()] || null);
    const out = [];
    for (let i = h + 1; i < grid.length; i++) {
        const obj = {};
        grid[i].forEach((val, j) => { if (header[j]) obj[header[j]] = val.trim(); });
        if (Object.keys(obj).length) out.push(obj);
    }
    return out;
}

export function renderImport(view) {
    view.innerHTML = '';
    view.appendChild(el('h1', {}, 'Import contacts'));

    // --- Import Gipity signups (the primary audience) ------------------------
    const acctCard = el('div', { class: 'card' },
        el('div', { class: 'card-title' }, 'Import Gipity signups'));
    acctCard.appendChild(el('p', { class: 'muted small' },
        'Pull people who signed up for Gipity straight from the platform (admin only). Each lands as a candidate with a funnel stage (signed up / active) and a starter knowledge base built from their account - apps they built, where they are, what they asked the agent to build.'));

    const createdAfter = el('input', { type: 'date', style: 'width:170px' });
    const limit = el('input', { type: 'number', value: 100, min: 1, max: 500, style: 'width:100px' });
    const acctStatus = el('p', { class: 'muted small' });
    acctCard.appendChild(el('div', { class: 'row' },
        el('label', { class: 'small muted' }, 'Signed up after'), createdAfter,
        el('label', { class: 'small muted' }, 'Max'), limit,
        el('button', { onclick: async () => {
            acctStatus.textContent = 'Fetching accounts...';
            let rows;
            try {
                const params = { limit: Number(limit.value) || 100 };
                if (createdAfter.value) params.created_after = new Date(createdAfter.value).toISOString();
                rows = (await api.accounts.list(params)).data || [];
            } catch (e) {
                acctStatus.textContent = e.message === 'UNAUTHENTICATED'
                    ? 'Sign in again to fetch accounts.'
                    : `Could not fetch accounts: ${e.message} (admin only).`;
                return;
            }
            if (!rows.length) { acctStatus.textContent = 'No accounts matched.'; return; }
            acctStatus.textContent = `Importing ${rows.length} signup(s)...`;
            let added = 0, updated = 0;
            try {
                for (let i = 0; i < rows.length; i += 100) {
                    const r = await api.signupsImport(rows.slice(i, i + 100));
                    added += r.added || 0; updated += r.updated || 0;
                }
                acctStatus.textContent = `Imported: ${added} new, ${updated} updated. Go qualify them.`;
                toast(`Imported ${added} new signups.`);
            } catch (e) { acctStatus.textContent = `Failed: ${e.message}`; }
        } }, 'Fetch & import'),
        el('a', { href: '#/candidates', class: 'pill' }, 'Go qualify'),
    ));
    acctCard.appendChild(acctStatus);
    view.appendChild(acctCard);

    // --- Import from a CSV (LinkedIn etc.) ----------------------------------
    view.appendChild(el('div', { class: 'card-title', style: 'margin-top:var(--space-lg)' }, 'Or import a CSV'));
    view.appendChild(el('p', { class: 'muted' },
        'Paste a LinkedIn connections export (Connections.csv) or any CSV with Name/Email/Company/Title columns. Contacts land as candidates to qualify - nothing is emailed until you qualify and approve.'));

    const ta = el('textarea', { placeholder: 'Paste CSV here...', style: 'width:100%;min-height:220px;font-family:monospace' });
    const status = el('p', { class: 'muted small' });
    view.appendChild(ta);
    view.appendChild(el('div', { class: 'actions' },
        el('button', { onclick: async () => {
            const rows = toRows(ta.value);
            if (!rows.length) { toast('No rows parsed - check the CSV.'); return; }
            status.textContent = `Importing ${rows.length} rows...`;
            let added = 0;
            try {
                for (let i = 0; i < rows.length; i += 200) {
                    const r = await api.linkedinImport(rows.slice(i, i + 200));
                    added += r.added || 0;
                }
                status.textContent = `Imported. ${added} new contact(s) added as candidates.`;
                toast(`Imported ${added} new contacts.`);
            } catch (e) { status.textContent = `Failed: ${e.message}`; }
        } }, 'Import'),
        el('a', { href: '#/candidates', class: 'pill' }, 'Go qualify candidates'),
    ));
    view.appendChild(status);
}
