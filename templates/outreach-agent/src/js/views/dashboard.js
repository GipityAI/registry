import { api } from '../api.js';
import { el, esc, fmtDate, timeAgo, setStatus } from '../util.js';
import { loadSettings } from '../main.js';

export async function renderDashboard(view) {
    setStatus(view, 'Loading funnel...');
    let d, s;
    try { [d, s] = await Promise.all([api.dashboard(), loadSettings()]); }
    catch (e) { setStatus(view, `Could not load: ${e.message}`); return; }

    view.innerHTML = '';
    view.appendChild(el('div', { class: 'spread' },
        el('h1', {}, 'Funnel'),
        el('a', { href: '#/approvals', class: 'pill learned' }, `${d.pending || 0} awaiting approval`),
    ));

    // Brain strip - who is governing this funnel + link out to edit it on Gipity.
    const agentName = s.agent_name || 'Outreach';
    view.appendChild(el('div', { class: 'brain' },
        el('div', {},
            el('div', { class: 'who' }, `Agent: ${esc(agentName)}`),
            el('div', { class: 'muted small' },
                s.agent_guid ? 'Drafting is governed by this agent (its voice + playbook). ' : 'Set the agent short_guid in Settings to connect the playbook. ',
                el('a', { href: 'https://prompt.gipity.ai', target: '_blank', rel: 'noopener' }, 'Edit its soul + goal on Gipity'),
                ' . ',
                el('a', { href: '#/playbook' }, 'See the playbook'),
            ),
        ),
    ));

    // The five-stage feedback funnel.
    const cols = [
        ['To draft', d.toDraft || 0, '#/contacts'],
        ['Pending approval', d.pending || 0, '#/approvals'],
        ['Scheduled', d.scheduled || 0, '#/contacts'],
        ['Sent (7d)', d.sent7 || 0, '#/contacts'],
        ['Replied', d.replied || 0, '#/contacts'],
    ];
    const board = el('div', { class: 'board' });
    for (const [label, n, href] of cols) {
        board.appendChild(el('a', { href, class: 'col', style: 'text-decoration:none' },
            el('span', { class: 'n' }, String(n)),
            el('span', { class: 'label' }, label),
        ));
    }
    view.appendChild(board);

    view.appendChild(el('div', { class: 'row' },
        el('a', { href: '#/candidates', class: 'pill' }, `${d.candidates || 0} candidates to qualify`),
        el('span', { class: 'pill' }, `${d.totalContacts || 0} contacts total`),
    ));

    // Recent activity.
    const recent = el('div', { class: 'card', style: 'margin-top:var(--space-lg)' }, el('div', { class: 'card-title' }, 'Recent activity'));
    if (!(d.recent || []).length) recent.appendChild(el('p', { class: 'muted' }, 'Nothing yet. Import contacts, qualify a few, and let the agent draft.'));
    for (const m of (d.recent || [])) {
        recent.appendChild(el('div', { class: 'spread', style: 'padding:var(--space-xs) 0;border-bottom:1px solid var(--border)' },
            el('span', {}, el('span', { class: 'pill' }, m.direction === 'inbound' ? 'reply' : m.status), ' ', esc(m.name || m.email || ''), ' - ', esc(m.subject || '(no subject)')),
            el('span', { class: 'muted small' }, timeAgo(m.created_at)),
        ));
    }
    view.appendChild(recent);
}
