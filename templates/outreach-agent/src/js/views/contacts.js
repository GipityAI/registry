import { api } from '../api.js';
import { el, esc, fmtDate, setStatus, toast } from '../util.js';

const CADENCES = ['every3', 'weekly', 'biweekly', 'monthly', 'paused'];
const STATUSES = ['new', 'in_sequence', 'replied', 'done', 'paused', 'to_qualify', 'disqualified', 'no_email'];
const STAGES = ['cold', 'signed_up', 'active'];
const PERSONAS = ['investor', 'developer', 'designer', 'games', 'enterprise', 'unknown'];

export async function renderContacts(view) {
    setStatus(view, 'Loading contacts...');
    let contacts;
    try { contacts = (await api.contacts.list()).contacts || []; }
    catch (e) { setStatus(view, `Could not load: ${e.message}`); return; }

    view.innerHTML = '';
    view.appendChild(el('div', { class: 'spread' }, el('h1', {}, 'Contacts'), el('a', { href: '#/candidates', class: 'pill' }, 'Qualify candidates')));
    if (!contacts.length) { view.appendChild(el('p', { class: 'muted' }, 'No contacts yet. Import some, then qualify your five.')); return; }

    const table = el('table', {}, el('thead', {}, el('tr', {},
        el('th', {}, 'Name'), el('th', {}, 'Stage'), el('th', {}, 'Persona'), el('th', {}, 'Status'),
        el('th', {}, 'Cadence'), el('th', {}, 'Next'), el('th', {}, 'Fit'))));
    const tbody = el('tbody', {});
    for (const c of contacts) {
        tbody.appendChild(el('tr', {},
            el('td', {}, el('a', { href: `#/contacts/${encodeURIComponent(c.short_guid)}` }, esc(c.name || c.email || c.short_guid))),
            el('td', {}, el('span', { class: 'pill' }, c.stage || 'cold')),
            el('td', { class: 'muted small' }, c.persona && c.persona !== 'unknown' ? c.persona : '-'),
            el('td', {}, el('span', { class: 'pill' }, c.status)),
            el('td', {}, c.cadence),
            el('td', { class: 'muted small' }, c.next_contact_at ? fmtDate(c.next_contact_at) : '-'),
            el('td', { class: 'muted small' }, String((c.fit_score || 0) + (c.engagement_score || 0))),
        ));
    }
    table.appendChild(tbody);
    view.appendChild(table);
}

export async function renderContactDetail(view, guid) {
    setStatus(view, 'Loading contact...');
    let data;
    try { data = await api.contacts.get(guid); }
    catch (e) { setStatus(view, `Could not load: ${e.message}`); return; }
    if (data.error) { setStatus(view, data.error); return; }
    const { contact: c, knowledge, messages } = data;

    view.innerHTML = '';
    view.appendChild(el('div', { class: 'spread' },
        el('h1', {}, esc(c.name || c.email || 'Contact')),
        el('a', { href: '#/contacts', class: 'muted small' }, '< all contacts')));
    view.appendChild(el('p', { class: 'muted' }, esc(c.email || ''), c.company ? ` - ${esc(c.company)}` : '', c.title ? ` - ${esc(c.title)}` : ''));

    // Stage + persona + status + cadence controls.
    const stageSel = el('select', {}, ...STAGES.map((x) => el('option', { value: x, selected: x === (c.stage || 'cold') }, x)));
    const personaSel = el('select', {}, ...PERSONAS.map((x) => el('option', { value: x, selected: x === (c.persona || 'unknown') }, x)));
    const statusSel = el('select', {}, ...STATUSES.map((x) => el('option', { value: x, selected: x === c.status }, x)));
    const cadenceSel = el('select', {}, ...CADENCES.map((x) => el('option', { value: x, selected: x === c.cadence }, x)));
    view.appendChild(el('div', { class: 'card' },
        el('div', { class: 'card-title' }, 'Stage, persona & cadence'),
        el('div', { class: 'row' },
            el('label', { class: 'small muted' }, 'Stage'), stageSel,
            el('label', { class: 'small muted' }, 'Persona'), personaSel,
            el('label', { class: 'small muted' }, 'Status'), statusSel,
            el('label', { class: 'small muted' }, 'Cadence'), cadenceSel,
            el('button', { class: 'small', onclick: async () => {
                try { await api.contacts.save({ short_guid: c.short_guid, email: c.email, name: c.name, company: c.company, title: c.title, notes: c.notes, status: statusSel.value, cadence: cadenceSel.value, stage: stageSel.value, persona: personaSel.value }); toast('Saved.'); renderContactDetail(view, guid); }
                catch (e) { toast(e.message); }
            } }, 'Save'),
            el('button', { class: 'small ghost', onclick: async () => {
                try { await api.contacts.dueNow(c.short_guid); toast('Marked due - the next draft run will pick them up.'); }
                catch (e) { toast(e.message); }
            } }, 'Draft now'),
        ),
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
