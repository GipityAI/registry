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

export async function renderPlaybook(view) {
    setStatus(view, 'Loading playbook...');
    const s = await loadSettings();

    view.innerHTML = '';
    view.appendChild(el('h1', {}, 'Playbook'));
    view.appendChild(el('p', { class: 'muted' },
        'The agent\'s living rulebook. Manual rules you set the tone with; learned rules accrete from your approval-queue comments. Both inject into every draft automatically.'));

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

    const list = (title, arr, cls) => {
        const card = el('div', { class: 'card', style: 'margin-bottom:var(--space-md)' }, el('div', { class: 'card-title' }, `${title} (${arr.length})`));
        if (!arr.length) card.appendChild(el('p', { class: 'muted small' }, title === 'Learned' ? 'None yet - comment on a draft to teach the agent its first rule.' : 'None yet - seed a few below.'));
        for (const r of arr) {
            card.appendChild(el('div', { class: 'knowledge-fact' },
                el('span', {}, el('span', { class: `pill ${cls}` }, r.source), ' ', esc(r.text)),
            ));
        }
        return card;
    };
    view.appendChild(list('Manual', manual, 'manual'));
    view.appendChild(list('Learned', learned, 'learned'));

    // Seed manual rules.
    const ta = el('textarea', { placeholder: 'One rule per line...', style: 'width:100%;min-height:90px' });
    const seedBox = el('div', { class: 'card' },
        el('div', { class: 'card-title' }, 'Add manual rules'),
        ta,
        el('div', { class: 'actions' },
            el('button', { onclick: async () => {
                const lines = ta.value.split('\n').map((x) => x.trim()).filter(Boolean);
                if (!lines.length) { toast('Type at least one rule.'); return; }
                try { await api.rules.seed(s.agent_guid, lines); toast('Rules added.'); renderPlaybook(view); }
                catch (e) { toast(e.message); }
            } }, 'Add rules'),
            el('button', { class: 'ghost', onclick: async () => {
                try { await api.rules.seed(s.agent_guid, STARTER_RULES); toast('Starter rules added.'); renderPlaybook(view); }
                catch (e) { toast(e.message); }
            } }, 'Add the 5 starter rules'),
        ),
    );
    view.appendChild(seedBox);
}
