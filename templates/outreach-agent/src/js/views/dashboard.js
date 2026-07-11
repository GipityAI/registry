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
        el('h1', {}, 'Overview'),
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

    // THE FUNNEL - recipients by stage, in order. This is the product: watch people
    // move right. Each column links to the funnel builder.
    const stages = d.funnelStages || [];
    if (stages.length) {
        view.appendChild(el('div', { class: 'card-title', style: 'margin-top:var(--space-lg)' }, 'The funnel'));
        const board = el('div', { class: 'board', style: `grid-template-columns:repeat(${stages.length}, 1fr)` });
        for (const s of stages) {
            board.appendChild(el('a', { href: '#/funnel', class: 'col', style: 'text-decoration:none', title: s.goal || '' },
                el('span', { class: 'n' }, String(s.recipients || 0)),
                el('span', { class: 'label' }, s.label),
                el('span', { class: 'muted small' },
                    (s.in_drip ? `${s.in_drip} in drip` : ''),
                    (s.in_drip && s.replied ? ' · ' : ''),
                    (s.replied ? `${s.replied} replied` : ''),
                    (!s.in_drip && !s.replied ? ' ' : '')),
            ));
        }
        view.appendChild(board);
    }

    // The work queue - what needs attention now.
    const cols = [
        ['Candidates to qualify', d.candidates || 0, '#/candidates'],
        ['To draft', d.toDraft || 0, '#/contacts'],
        ['Pending approval', d.pending || 0, '#/approvals'],
        ['Scheduled', d.scheduled || 0, '#/contacts'],
        ['Sent (7d)', d.sent7 || 0, '#/contacts'],
        ['Replied', d.replied || 0, '#/contacts'],
    ];
    view.appendChild(el('div', { class: 'card-title', style: 'margin-top:var(--space-lg)' }, 'Work queue'));
    const queue = el('div', { class: 'board', style: `grid-template-columns:repeat(${cols.length}, 1fr)` });
    for (const [label, n, href] of cols) {
        queue.appendChild(el('a', { href, class: 'col', style: 'text-decoration:none' },
            el('span', { class: 'n' }, String(n)),
            el('span', { class: 'label' }, label),
        ));
    }
    view.appendChild(queue);

    view.appendChild(el('div', { class: 'row', style: 'margin-top:var(--space-sm)' },
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
