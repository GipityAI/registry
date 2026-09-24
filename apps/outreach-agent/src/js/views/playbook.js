import { api } from '../api.js';
import { el, esc, setStatus, toast } from '../util.js';
import { loadSettings } from '../main.js';

const STARTER_RULES = [
    'Always be candid that this email was drafted by an AI agent running on Gipity - that honesty is the point.',
    'Keep emails under about 120 words. One specific idea, not a feature list.',
    'Exactly one clear, low-friction call to action.',
    'Write like one human to another - never a mass blast. Use only facts from the contact knowledge; never invent details.',
    'Plain ASCII punctuation only. No em dashes, en dashes, smart quotes, or ellipsis characters.',
];
const norm = (s) => String(s || '').trim().toLowerCase();

export async function renderPlaybook(view) {
    setStatus(view, 'Loading playbook...');
    const s = await loadSettings();

    view.innerHTML = '';
    view.appendChild(el('h1', {}, 'Playbook'));
    view.appendChild(el('p', { class: 'muted' },
        'The agent\'s living rulebook. Manual rules set the tone; learned rules accrete from your approval-queue comments. Both inject into every draft.'));

    if (!s.agent_guid) {
        view.appendChild(el('div', { class: 'card' },
            el('p', {}, 'Connect the Outreach agent first: paste its short_guid in ', el('a', { href: '#/settings' }, 'Settings'), '.')));
        return;
    }

    let rules;
    try { rules = (await api.rules.list(s.agent_guid)).data || []; }
    catch (e) {
        if (e.message === 'UNAUTHENTICATED') { setStatus(view, 'Session expired - sign in again.'); return; }
        setStatus(view, `Could not load rules: ${e.message}`); return;
    }

    const manual = rules.filter((r) => r.source === 'manual');
    const learned = rules.filter((r) => r.source === 'learned');

    // Duplicate detection (same text, case-insensitive) so we can offer a one-click tidy.
    const seen = new Set();
    const dupes = [];
    for (const r of rules) { const k = `${r.source}::${norm(r.text)}`; if (seen.has(k)) dupes.push(r); else seen.add(k); }
    const missingStarters = STARTER_RULES.filter((t) => !manual.some((r) => norm(r.text) === norm(t)));

    const remove = (r) => act(view, () => api.rules.remove(s.agent_guid, r.short_guid), 'Rule removed.');

    const list = (title, arr, cls) => {
        const card = el('div', { class: 'card', style: 'margin-bottom:var(--space-md)' }, el('div', { class: 'card-title' }, `${title} (${arr.length})`));
        if (!arr.length) card.appendChild(el('p', { class: 'muted small' }, title === 'Learned' ? 'None yet - comment on a draft to teach the agent its first rule.' : 'None yet - restore the starters or add your own below.'));
        for (const r of arr) {
            card.appendChild(el('div', { class: 'knowledge-fact', style: 'display:flex;gap:var(--space-sm);align-items:flex-start' },
                el('span', { style: 'flex:1' }, el('span', { class: `pill ${cls}` }, r.source), ' ', esc(r.text)),
                el('button', { class: 'small ghost', title: 'Delete rule', onclick: () => remove(r) }, 'x'),
            ));
        }
        return card;
    };
    view.appendChild(list('Manual', manual, 'manual'));
    view.appendChild(list('Learned', learned, 'learned'));

    // Maintenance: restore missing starters (idempotent) + tidy duplicates.
    const maint = el('div', { class: 'card' }, el('div', { class: 'card-title' }, 'Starter rules'));
    if (missingStarters.length) {
        maint.appendChild(el('p', { class: 'muted small' }, `${missingStarters.length} of the 5 starter rules ${missingStarters.length === 1 ? 'is' : 'are'} missing.`));
        maint.appendChild(el('button', { class: 'small', onclick: () =>
            act(view, () => api.rules.seed(s.agent_guid, missingStarters), 'Starter rules restored.') }, `Restore ${missingStarters.length} starter rule(s)`));
    } else {
        maint.appendChild(el('p', { class: 'muted small' }, 'All 5 starter rules are in place. Delete any with the x above.'));
    }
    if (dupes.length) {
        maint.appendChild(el('div', { style: 'margin-top:var(--space-sm)' },
            el('button', { class: 'small ghost', onclick: async () => {
                try { for (const d of dupes) await api.rules.remove(s.agent_guid, d.short_guid); toast(`Removed ${dupes.length} duplicate(s).`); renderPlaybook(view); }
                catch (e) { toast(e.message); }
            } }, `Remove ${dupes.length} duplicate rule(s)`)));
    }
    view.appendChild(maint);

    // Add your own manual rules.
    const ta = el('textarea', { placeholder: 'One rule per line...', style: 'width:100%;min-height:90px' });
    view.appendChild(el('div', { class: 'card' },
        el('div', { class: 'card-title' }, 'Add manual rules'),
        ta,
        el('div', { class: 'actions' },
            el('button', { onclick: () => {
                const lines = ta.value.split('\n').map((x) => x.trim()).filter(Boolean)
                    .filter((t) => !manual.some((r) => norm(r.text) === norm(t))); // skip ones already present
                if (!lines.length) { toast('Nothing new to add.'); return; }
                act(view, () => api.rules.seed(s.agent_guid, lines), 'Rules added.');
            } }, 'Add rules'),
        ),
    ));
}

async function act(view, thunk, okMsg) {
    try { const r = await thunk(); if (r && r.error) { toast(r.error); return; } toast(okMsg); renderPlaybook(view); }
    catch (e) { toast(e.message); }
}
