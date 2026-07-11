import { api } from '../api.js';
import { el, esc, fmtDate, fmtDay, setStatus, toast, sortableTable, stageLabels, stageLabelFor } from '../util.js';

const CADENCES = ['every3', 'weekly', 'biweekly', 'monthly', 'paused'];
const STATUSES = ['new', 'in_sequence', 'replied', 'done', 'paused', 'to_qualify', 'disqualified', 'no_email', 'unsubscribed'];

export async function renderContacts(view) {
    setStatus(view, 'Loading contacts...');
    let contacts, labels;
    try {
        [contacts, labels] = await Promise.all([
            api.contacts.list().then((r) => r.contacts || []), stageLabels()]);
    } catch (e) { setStatus(view, `Could not load: ${e.message}`); return; }

    view.innerHTML = '';
    view.appendChild(el('div', { class: 'spread' }, el('h1', {}, '2 · Contacts'), el('a', { href: '#/candidates', class: 'pill' }, 'Qualify candidates')));
    if (!contacts.length) { view.appendChild(el('p', { class: 'muted' }, 'No contacts yet. Import some, then qualify the ones you want to reach.')); return; }

    const ms = (iso) => (iso ? new Date(iso).getTime() : null);
    view.appendChild(el('p', { class: 'muted small' }, `${contacts.length} contact(s). Click a header to sort.`));
    view.appendChild(sortableTable([
        { label: 'Name', cell: (c) => el('a', { href: `#/contacts/${encodeURIComponent(c.short_guid)}` }, esc(c.name || c.email || c.short_guid)), sort: (c) => (c.name || c.email || '').toLowerCase() },
        { label: 'Stage', cell: (c) => el('span', { class: 'pill' }, stageLabelFor(c, labels)), sort: (c) => stageLabelFor(c, labels) },
        { label: 'Status', cell: (c) => el('span', { class: 'pill' }, c.status), sort: (c) => c.status || '' },
        { label: 'Cadence', cell: (c) => c.cadence, sort: (c) => c.cadence || '' },
        { label: 'Signed up', th: { class: 'muted small' }, cell: (c) => fmtDay(c.signup_at), sort: (c) => ms(c.signup_at), initial: 'desc' },
        { label: 'Next', th: { class: 'muted small' }, cell: (c) => (c.next_contact_at ? fmtDate(c.next_contact_at) : '-'), sort: (c) => ms(c.next_contact_at), initial: 'asc' },
        { label: 'Fit', th: { class: 'muted small' }, cell: (c) => String((c.fit_score || 0) + (c.engagement_score || 0)), sort: (c) => (c.fit_score || 0) + (c.engagement_score || 0), initial: 'desc' },
    ], contacts, 0, 'asc'));
}

export async function renderContactDetail(view, guid) {
    setStatus(view, 'Loading contact...');
    let data, funnels;
    try {
        [data, funnels] = await Promise.all([
            api.contacts.get(guid), api.funnels.list().then((r) => r.funnels || [])]);
    } catch (e) { setStatus(view, `Could not load: ${e.message}`); return; }
    if (data.error) { setStatus(view, data.error); return; }
    const { contact: c, knowledge, messages } = data;

    view.innerHTML = '';
    view.appendChild(el('div', { class: 'spread' },
        el('h1', {}, esc(c.name || c.email || 'Contact')),
        el('a', { href: '#/contacts', class: 'muted small' }, '< all contacts')));
    view.appendChild(el('p', { class: 'muted' },
        esc(c.email || ''), c.company ? ` - ${esc(c.company)}` : '', c.title ? ` - ${esc(c.title)}` : '',
        c.signup_at ? ` - signed up ${fmtDay(c.signup_at)}` : ''));

    // Funnel stage + status + cadence controls. Stage options come from the funnel
    // data; moving a contact restarts their sequence for the new stage.
    const stageOptions = funnels.flatMap((f) => (f.stages || []).map((s) =>
        el('option', { value: s.short_guid, selected: s.short_guid === c.stage_guid },
            funnels.length > 1 ? `${f.name}: ${s.label}` : s.label)));
    const stageSel = el('select', {}, ...stageOptions);
    const statusSel = el('select', {}, ...STATUSES.map((x) => el('option', { value: x, selected: x === c.status }, x)));
    const cadenceSel = el('select', {}, ...CADENCES.map((x) => el('option', { value: x, selected: x === c.cadence }, x)));
    view.appendChild(el('div', { class: 'card' },
        el('div', { class: 'card-title' }, 'Funnel stage & cadence'),
        el('div', { class: 'row' },
            el('label', { class: 'small muted' }, 'Stage'), stageSel,
            el('label', { class: 'small muted' }, 'Status'), statusSel,
            el('label', { class: 'small muted' }, 'Cadence'), cadenceSel,
            el('button', { class: 'small', onclick: async () => {
                try {
                    const r = await api.contacts.save({ short_guid: c.short_guid, email: c.email, name: c.name, company: c.company, title: c.title, notes: c.notes, status: statusSel.value, cadence: cadenceSel.value, stage_guid: stageSel.value });
                    if (r && r.error) { toast(r.error); return; }
                    toast('Saved.'); renderContactDetail(view, guid);
                } catch (e) { toast(e.message); }
            } }, 'Save'),
            el('button', { class: 'small ghost', onclick: async () => {
                try { await api.contacts.dueNow(c.short_guid); toast('Marked due - the next draft run will pick them up.'); }
                catch (e) { toast(e.message); }
            } }, 'Draft now'),
        ),
        el('p', { class: 'muted small', style: 'margin:var(--space-xs) 0 0' },
            'Moving the stage restarts their touch sequence with the new stage\'s ask.'),
    ));

    // Knowledge base - hand-editable.
    const kbCard = el('div', { class: 'card' }, el('div', { class: 'card-title' }, `Knowledge base (${(knowledge || []).length})`));
    if (!(knowledge || []).length) kbCard.appendChild(el('p', { class: 'muted small' }, 'Empty. The enrich workflow fills this from your Gmail history, or add facts by hand.'));
    for (const k of (knowledge || [])) {
        kbCard.appendChild(el('div', { class: 'knowledge-fact' },
            el('span', {}, el('span', { class: 'pill' }, k.source), ' ', esc(k.content)),
            el('button', { class: 'small ghost', onclick: async () => { try { await api.knowledge.remove(k.short_guid); renderContactDetail(view, guid); } catch (e) { toast(e.message); } } }, 'x'),
        ));
    }
    const factInput = el('input', { type: 'text', placeholder: 'Add a fact about them...', style: 'flex:1' });
    kbCard.appendChild(el('div', { class: 'row', style: 'margin-top:var(--space-sm)' }, factInput,
        el('button', { class: 'small', onclick: async () => {
            if (!factInput.value.trim()) return;
            try { await api.knowledge.add(c.short_guid, factInput.value.trim()); toast('Fact added.'); renderContactDetail(view, guid); }
            catch (e) { toast(e.message); }
        } }, 'Add')));
    view.appendChild(kbCard);

    // Message history.
    const histCard = el('div', { class: 'card' }, el('div', { class: 'card-title' }, `Messages (${(messages || []).length})`));
    if (!(messages || []).length) histCard.appendChild(el('p', { class: 'muted small' }, 'No messages yet.'));
    for (const m of (messages || [])) {
        histCard.appendChild(el('div', { style: 'padding:var(--space-sm) 0;border-bottom:1px solid var(--border)' },
            el('div', { class: 'spread' },
                el('span', {}, el('span', { class: 'pill' }, m.direction === 'inbound' ? 'reply' : m.status), ' ', el('strong', {}, esc(m.subject || '(no subject)'))),
                el('span', { class: 'muted small' }, fmtDate(m.created_at))),
            el('div', { class: 'draft-body small muted' }, esc((m.body || '').slice(0, 500))),
        ));
    }
    view.appendChild(histCard);
}
