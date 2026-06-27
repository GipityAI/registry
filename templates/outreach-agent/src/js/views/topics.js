import { api } from '../api.js';
import { el, esc, setStatus, toast } from '../util.js';

// The topics library: the things outreach can be ABOUT. The draft step picks an
// active topic matching a contact's (stage, persona); "any" = fits everyone.
const STAGES = ['any', 'cold', 'signed_up', 'active'];
const PERSONAS = ['any', 'investor', 'developer', 'designer', 'games', 'enterprise', 'unknown'];

export async function renderTopics(view) {
    setStatus(view, 'Loading topics...');
    let topics;
    try { topics = (await api.topics.list()).topics || []; }
    catch (e) { setStatus(view, `Could not load: ${e.message}`); return; }

    view.innerHTML = '';
    view.appendChild(el('h1', {}, 'Topics'));
    view.appendChild(el('p', { class: 'muted' },
        'What outreach is about. Each draft picks one active topic that matches the contact\'s stage + persona - leave a target as "any" to make a topic fit everyone.'));

    // Add-a-topic form.
    const title = el('input', { type: 'text', placeholder: 'Topic title', style: 'width:100%' });
    const body = el('textarea', { placeholder: 'What to say about it / why it matters...', style: 'width:100%;min-height:64px' });
    const stage = el('select', {}, ...STAGES.map((x) => el('option', { value: x }, x)));
    const persona = el('select', {}, ...PERSONAS.map((x) => el('option', { value: x }, x)));
    view.appendChild(el('div', { class: 'card' },
        el('div', { class: 'card-title' }, 'Add a topic'),
        title, body,
        el('div', { class: 'row', style: 'margin-top:var(--space-sm)' },
            el('label', { class: 'small muted' }, 'Stage'), stage,
            el('label', { class: 'small muted' }, 'Persona'), persona,
            el('button', { class: 'small', onclick: async () => {
                if (!title.value.trim()) { toast('Title is required.'); return; }
                try {
                    await api.topics.save({ title: title.value.trim(), body: body.value.trim(), audience_stage: stage.value, audience_persona: persona.value });
                    toast('Topic added.'); renderTopics(view);
                } catch (e) { toast(e.message); }
            } }, 'Add topic'),
        ),
    ));

    if (!topics.length) { view.appendChild(el('p', { class: 'muted' }, 'No topics yet. Add one above.')); return; }

    const table = el('table', {}, el('thead', {}, el('tr', {},
        el('th', {}, 'Topic'), el('th', {}, 'Stage'), el('th', {}, 'Persona'), el('th', {}, 'Active'), el('th', {}, ''))));
    const tbody = el('tbody', {});
    for (const t of topics) {
        tbody.appendChild(el('tr', { style: t.active ? '' : 'opacity:0.55' },
            el('td', {}, el('strong', {}, esc(t.title)), t.body ? el('div', { class: 'muted small' }, esc(t.body)) : null),
            el('td', { class: 'muted small' }, t.audience_stage || 'any'),
            el('td', { class: 'muted small' }, t.audience_persona || 'any'),
            el('td', {}, el('span', { class: 'pill' }, t.active ? 'active' : 'off')),
            el('td', {}, el('div', { class: 'row' },
                el('button', { class: 'small ghost', onclick: async () => {
                    try { await api.topics.toggle(t.short_guid); renderTopics(view); } catch (e) { toast(e.message); }
                } }, t.active ? 'Disable' : 'Enable'),
                el('button', { class: 'small ghost', onclick: async () => {
                    try { await api.topics.remove(t.short_guid); renderTopics(view); } catch (e) { toast(e.message); }
                } }, 'x'),
            )),
        ));
    }
    table.appendChild(tbody);
    view.appendChild(table);
}
