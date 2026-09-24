import { api } from '../api.js';
import { el, esc, setStatus, toast, sortableTable, fmtDay, stageLabels, stageLabelFor } from '../util.js';
import { refreshNavBadges } from '../main.js';

export async function renderCandidates(view) {
    setStatus(view, 'Loading candidates...');
    let items, labels;
    try { [items, labels] = await Promise.all([api.candidates.list().then((r) => r.items || []), stageLabels()]); }
    catch (e) { setStatus(view, `Could not load: ${e.message}`); return; }

    view.innerHTML = '';
    view.appendChild(el('h1', {}, '3 · Candidates'));
    view.appendChild(el('p', { class: 'muted' },
        'Imported contacts awaiting qualification. Qualify the ones you actually want to reach - each one you qualify gets enriched from your Gmail and enters the funnel. Click a header to sort.'));

    if (!items.length) { view.appendChild(el('p', { class: 'muted' }, 'No candidates. ', el('a', { href: '#/import' }, 'Import some contacts'), ' to get started.')); return; }

    const dayMs = (iso) => (iso ? new Date(iso).getTime() : null);
    const reload = () => renderCandidates(view);

    view.appendChild(el('p', { class: 'muted small' }, `${items.length} candidate(s).`));
    view.appendChild(sortableTable([
        { label: 'Name', cell: (c) => esc(c.name || '-'), sort: (c) => (c.name || '').toLowerCase() },
        { label: 'Email', th: { class: 'small' }, cell: (c) => esc(c.email || '(no email)'), sort: (c) => c.email || '' },
        { label: 'Signed up', th: { class: 'small' }, cell: (c) => fmtDay(c.signup_at), sort: (c) => dayMs(c.signup_at), initial: 'desc' },
        { label: 'Stage', th: { class: 'small' }, cell: (c) => stageLabelFor(c, labels), sort: (c) => stageLabelFor(c, labels) },
        { label: 'Fit', th: { class: 'small' }, cell: (c) => String(c.fit_score || 0), sort: (c) => Number(c.fit_score || 0), initial: 'desc' },
        { label: 'Notes', th: { class: 'muted small' }, cell: (c) => esc((c.notes || '').slice(0, 80)) },
        { label: '', cell: (c) => el('div', { class: 'row' },
            el('button', { class: 'small', onclick: async () => {
                try { const r = await api.candidates.approve(c.short_guid); if (r && r.error) { toast(r.error); return; } toast('Qualified - enriching from Gmail.'); refreshNavBadges(); reload(); }
                catch (e) { toast(e.message); }
            } }, 'Qualify'),
            el('button', { class: 'small ghost', onclick: async () => {
                try { await api.candidates.reject(c.short_guid); refreshNavBadges(); reload(); }
                catch (e) { toast(e.message); }
            } }, 'Skip'),
        ) },
    ], items, 4, 'desc')); // default sort: Fit, descending
}
