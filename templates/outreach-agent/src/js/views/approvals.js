import { api } from '../api.js';
import { el, esc, setStatus, toast } from '../util.js';
import { loadSettings, refreshNavBadges } from '../main.js';

export async function renderApprovals(view) {
    setStatus(view, 'Loading approvals...');
    let items, s;
    try { [items, s] = await Promise.all([api.review.queue().then((r) => r.items || []), loadSettings()]); }
    catch (e) { setStatus(view, `Could not load: ${e.message}`); return; }

    view.innerHTML = '';
    view.appendChild(el('h1', {}, 'Approvals'));
    view.appendChild(el('p', { class: 'muted' },
        'Approve, reject, or comment. A comment redrafts this message AND teaches the agent a durable rule (see the ',
        el('a', { href: '#/playbook' }, 'Playbook'), ') so it never makes the same mistake again.'));

    if (!items.length) { view.appendChild(el('p', { class: 'muted' }, 'Queue is empty. When contacts come due, drafts land here.')); return; }

    for (const m of items) view.appendChild(card(m, s, view));
}

function card(m, s, view) {
    const revising = m.status === 'revising';
    const subjectInput = el('input', { type: 'text', value: m.subject || '' });
    const bodyArea = el('textarea', {}, m.body || '');
    const commentArea = el('textarea', { placeholder: 'e.g. Too salesy - lead with a specific observation about them, not a pitch.', style: 'min-height:64px' });

    const wrap = el('div', { class: 'queue-item' },
        el('div', { class: 'head' },
            el('div', {},
                el('strong', {}, esc(m.name || m.email || 'Contact')),
                ' ', el('span', { class: 'muted small' }, esc(m.email || '')),
                m.company ? el('span', { class: 'muted small' }, ` - ${esc(m.company)}`) : null,
            ),
            el('span', { class: 'pill' + (revising ? ' learned' : '') }, revising ? 'redrafting...' : `touch ${(m.seq_step ?? 0) + 1}`),
        ),
        m.rationale ? el('div', { class: 'rationale' }, esc(m.rationale)) : null,
        el('label', { class: 'small muted' }, 'Subject'), subjectInput,
        el('label', { class: 'small muted' }, 'Body'), bodyArea,
    );

    if (revising) {
        wrap.appendChild(el('p', { class: 'muted small' }, 'You commented on this - the agent is redrafting it. It will reappear here as a fresh draft shortly.'));
        return wrap;
    }

    const disable = (b) => wrap.querySelectorAll('button, input, textarea').forEach((n) => { n.disabled = b; });

    const approveBtn = el('button', { onclick: async () => {
        disable(true);
        try {
            await api.review.approve(m.short_guid, { edited_subject: subjectInput.value, edited_body: bodyArea.value });
            toast('Approved - it will send at its scheduled window.');
            wrap.remove(); refreshNavBadges();
        } catch (e) { toast(e.message); disable(false); }
    } }, 'Approve');

    const rejectBtn = el('button', { class: 'ghost', onclick: async () => {
        const reason = prompt('Why are you rejecting this? (also teaches the agent)');
        if (reason === null) return;
        disable(true);
        try {
            await api.review.reject(m.short_guid, reason);
            if (reason.trim()) await teach(s, m.body, reason);
            toast('Rejected.');
            wrap.remove(); refreshNavBadges();
        } catch (e) { toast(e.message); disable(false); }
    } }, 'Reject');

    const commentBtn = el('button', { class: 'ghost', onclick: async () => {
        const comment = commentArea.value.trim();
        if (!comment) { toast('Write a comment first.'); return; }
        disable(true);
        try {
            await api.review.comment(m.short_guid, comment);     // flips to revising; revise cron redrafts
            const taught = await teach(s, m.body, comment);       // teach the agent now
            toast(taught ? 'Comment sent: redrafting + learned a new rule.' : 'Comment sent: redrafting.');
            wrap.remove(); refreshNavBadges();
        } catch (e) { toast(e.message); disable(false); }
    } }, 'Comment & redraft');

    wrap.appendChild(el('div', { class: 'actions' }, approveBtn, rejectBtn));
    wrap.appendChild(el('label', { class: 'small muted', style: 'margin-top:var(--space-sm)' }, 'Comment (redrafts + teaches the agent)'));
    wrap.appendChild(commentArea);
    wrap.appendChild(el('div', { class: 'actions' }, commentBtn));
    return wrap;
}

// Teach the agent via the platform bridge. Returns true if a rule was saved.
async function teach(s, original, comment) {
    if (!s.agent_guid) { toast('Set the agent short_guid in Settings to enable learning.'); return false; }
    try {
        const r = await api.rules.learn(s.agent_guid, original || '(no draft)', comment);
        return Boolean(r?.data?.saved);
    } catch (e) {
        toast(`Learning skipped: ${e.message}`);
        return false;
    }
}
