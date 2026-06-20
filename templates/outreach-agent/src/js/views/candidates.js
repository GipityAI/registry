import { api } from '../api.js';
import { el, esc, setStatus, toast } from '../util.js';
import { refreshNavBadges } from '../main.js';

export async function renderCandidates(view) {
    setStatus(view, 'Loading candidates...');
    let items;
    try { items = (await api.candidates.list()).items || []; }
    catch (e) { setStatus(view, `Could not load: ${e.message}`); return; }

    view.innerHTML = '';
    view.appendChild(el('h1', {}, 'Candidates'));
    view.appendChild(el('p', { class: 'muted' },
        'Imported contacts awaiting qualification. Qualify the few you actually want to reach - each one you qualify gets enriched from your Gmail and enters the sequence.'));

    if (!items.length) { view.appendChild(el('p', { class: 'muted' }, 'No candidates. ', el('a', { href: '#/import' }, 'Import some contacts'), ' to get started.')); return; }

    const table = el('table', {}, el('thead', {}, el('tr', {},
        el('th', {}, 'Name'), el('th', {}, 'Email'), el('th', {}, 'Fit'), el('th', {}, 'Notes'), el('th', {}, ''))));
    const tbody = el('tbody', {});
    for (const c of items) {
        const row = el('tr', {},
            el('td', {}, esc(c.name || '-')),
            el('td', { class: 'small' }, esc(c.email || '(no email)')),
            el('td', { class: 'muted small' }, String(c.fit_score || 0)),
            el('td', { class: 'muted small' }, esc((c.notes || '').slice(0, 80))),
            el('td', {},
                el('button', { class: 'small', onclick: async () => {
                    try { await api.candidates.approve(c.short_guid); toast('Qualified - enriching from Gmail.'); row.remove(); refreshNavBadges(); }
                    catch (e) { toast(e.message); }
                } }, 'Qualify'),
                ' ',
                el('button', { class: 'small ghost', onclick: async () => {
                    try { await api.candidates.reject(c.short_guid); row.remove(); refreshNavBadges(); }
                    catch (e) { toast(e.message); }
                } }, 'Skip'),
            ),
        );
        tbody.appendChild(row);
    }
    table.appendChild(tbody);
    view.appendChild(table);
}
