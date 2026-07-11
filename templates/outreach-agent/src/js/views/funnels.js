import { api } from '../api.js';
import { el, esc, setStatus, toast, stageLabels } from '../util.js';

// The funnel builder (nav step 4). Funnels are data: each has an ordered set of stages,
// and each stage carries OUR goal (move them forward), the email ASK, and the topics
// to talk about. Recipients live in a funnel at a stage. You can define more than one
// funnel and any number of stages.
let selected = null; // short_guid of the funnel currently being viewed

export async function renderFunnels(view) {
    setStatus(view, 'Loading funnel...');
    let funnels;
    let topicsByStage = {};
    try {
        funnels = (await api.funnels.list()).funnels || [];
        const allTopics = (await api.topics.list()).topics || [];
        for (const t of allTopics) (topicsByStage[t.stage_guid || '_none'] ||= []).push(t);
    } catch (e) { setStatus(view, `Could not load: ${e.message}`); return; }

    if (!funnels.length) {
        view.innerHTML = '';
        view.appendChild(el('h1', {}, '4 · Funnel'));
        view.appendChild(el('p', { class: 'muted' }, 'No funnels yet. A funnel is a set of stages your recipients move through.'));
        view.appendChild(newFunnelCard(view));
        return;
    }

    if (!selected || !funnels.some((f) => f.short_guid === selected)) {
        selected = (funnels.find((f) => f.is_default) || funnels[0]).short_guid;
    }
    const funnel = funnels.find((f) => f.short_guid === selected);

    view.innerHTML = '';
    view.appendChild(el('h1', {}, '4 · Funnel'));
    view.appendChild(el('p', { class: 'muted' },
        'Recipients move through these stages. Each stage sets your goal (get them to the next stage), the ask each email makes, and the topics to talk about.'));

    // Funnel picker + actions.
    const picker = el('select', { onchange: (e) => { selected = e.target.value; renderFunnels(view); } },
        ...funnels.map((f) => el('option', { value: f.short_guid, selected: f.short_guid === selected },
            `${f.name}${f.is_default ? ' (default)' : ''}`)));
    view.appendChild(el('div', { class: 'card' },
        el('div', { class: 'row', style: 'align-items:center;flex-wrap:wrap;gap:var(--space-sm)' },
            el('label', { class: 'small muted' }, 'Funnel'), picker,
            funnel.is_default ? el('span', { class: 'pill' }, 'default')
                : el('button', { class: 'small ghost', onclick: () => act(view, () => api.funnels.setDefault(funnel.short_guid), 'Set as default.') }, 'Make default'),
            el('button', { class: 'small ghost', onclick: () => renameFunnel(view, funnel) }, 'Rename'),
            el('button', { class: 'small ghost', onclick: () => act(view, () => api.funnels.removeFunnel(funnel.short_guid), 'Funnel deleted.') }, 'Delete funnel'),
            el('span', { style: 'flex:1' }),
            el('button', { class: 'small', onclick: () => { const c = newFunnelCard(view); view.appendChild(c); c.scrollIntoView({ behavior: 'smooth' }); } }, '+ New funnel'),
        ),
        funnel.description ? el('div', { class: 'muted small', style: 'margin-top:var(--space-xs)' }, esc(funnel.description)) : null,
    ));

    // Stages.
    const stages = funnel.stages || [];
    stages.forEach((stage, i) => view.appendChild(stageCard(view, funnel, stage, i, stages.length, topicsByStage[stage.short_guid] || [])));

    // Add a stage.
    const label = el('input', { type: 'text', placeholder: 'New stage name (e.g. Trial started)', style: 'flex:1' });
    view.appendChild(el('div', { class: 'card' },
        el('div', { class: 'card-title' }, 'Add a stage'),
        el('div', { class: 'row', style: 'gap:var(--space-sm)' }, label,
            el('button', { class: 'small', onclick: () => {
                if (!label.value.trim()) { toast('Name the stage.'); return; }
                act(view, () => api.funnels.saveStage({ funnel_guid: funnel.short_guid, label: label.value.trim() }), 'Stage added.');
            } }, 'Add stage')),
    ));
}

function stageCard(view, funnel, stage, i, total, topics) {
    const num = `${i + 1}`;
    const goal = el('textarea', { style: 'width:100%;min-height:48px' }, stage.goal || '');
    const ask = el('textarea', { style: 'width:100%;min-height:48px' }, stage.ask || '');

    const head = el('div', { class: 'row', style: 'align-items:center;gap:var(--space-sm)' },
        el('span', { class: 'pill', style: 'font-variant-numeric:tabular-nums' }, `Stage ${num}`),
        el('strong', {}, esc(stage.label)),
        el('span', { class: 'muted small' }, `${stage.recipient_count || 0} recipient(s)`),
        el('span', { style: 'flex:1' }),
        i > 0 ? el('button', { class: 'small ghost', title: 'Move up', onclick: () => reorder(view, funnel, i, i - 1) }, '↑') : null,
        i < total - 1 ? el('button', { class: 'small ghost', title: 'Move down', onclick: () => reorder(view, funnel, i, i + 1) }, '↓') : null,
        el('button', { class: 'small ghost', onclick: () => act(view, () => api.funnels.removeStage(stage.short_guid), 'Stage deleted.') }, 'Delete'),
    );

    const save = el('button', { class: 'small', onclick: () =>
        act(view, () => api.funnels.saveStage({ short_guid: stage.short_guid, goal: goal.value, ask: ask.value }), 'Stage saved.') }, 'Save stage');

    return el('div', { class: 'card', style: 'margin-bottom:var(--space-md)' },
        head,
        el('label', { class: 'small', style: 'margin-top:var(--space-sm);display:block' }, 'Our goal at this stage'),
        el('div', { class: 'muted small' }, 'What we want next (move them toward the following stage).'),
        goal,
        el('label', { class: 'small', style: 'margin-top:var(--space-sm);display:block' }, 'The ask'),
        el('div', { class: 'muted small' }, 'What each email to recipients at this stage should get them to do.'),
        ask,
        el('div', { style: 'margin-top:var(--space-sm)' }, save),
        topicsBlock(view, stage, topics),
    );
}

function topicsBlock(view, stage, topics) {
    const wrap = el('div', { style: 'margin-top:var(--space-md);border-top:1px solid var(--border, #333);padding-top:var(--space-sm)' },
        el('div', { class: 'small', style: 'font-weight:600' }, `Topics for this stage (${topics.length})`),
        el('div', { class: 'muted small' }, 'What emails at this stage can be about; the agent picks one per draft.'));

    for (const t of topics) {
        wrap.appendChild(el('div', { class: 'row', style: `align-items:center;gap:var(--space-sm);${t.active ? '' : 'opacity:0.55'}` },
            el('span', { style: 'flex:1' }, el('strong', {}, esc(t.title)), t.body ? el('div', { class: 'muted small' }, esc(t.body)) : null),
            el('button', { class: 'small ghost', onclick: () => act(view, () => api.topics.toggle(t.short_guid), t.active ? 'Disabled.' : 'Enabled.') }, t.active ? 'Disable' : 'Enable'),
            el('button', { class: 'small ghost', onclick: () => act(view, () => api.topics.remove(t.short_guid), 'Topic removed.') }, 'x'),
        ));
    }

    const tt = el('input', { type: 'text', placeholder: 'Topic title', style: 'flex:1' });
    const tb = el('input', { type: 'text', placeholder: 'What to say about it (optional)', style: 'flex:2' });
    wrap.appendChild(el('div', { class: 'row', style: 'gap:var(--space-sm);margin-top:var(--space-xs)' }, tt, tb,
        el('button', { class: 'small ghost', onclick: () => {
            if (!tt.value.trim()) { toast('Topic needs a title.'); return; }
            act(view, () => api.topics.save({ title: tt.value.trim(), body: tb.value.trim(), stage_guid: stage.short_guid }), 'Topic added.');
        } }, '+ Topic')));
    return wrap;
}

function newFunnelCard(view) {
    const name = el('input', { type: 'text', placeholder: 'Funnel name', style: 'width:100%' });
    const desc = el('input', { type: 'text', placeholder: 'Short description (optional)', style: 'width:100%' });
    return el('div', { class: 'card' }, el('div', { class: 'card-title' }, 'New funnel'), name, desc,
        el('div', { style: 'margin-top:var(--space-sm)' },
            el('button', { class: 'small', onclick: async () => {
                if (!name.value.trim()) { toast('Name the funnel.'); return; }
                try {
                    const r = await api.funnels.saveFunnel({ name: name.value.trim(), description: desc.value.trim() });
                    selected = r.funnel?.short_guid || selected;
                    toast('Funnel created.'); renderFunnels(view);
                } catch (e) { toast(e.message); }
            } }, 'Create funnel')));
}

async function renameFunnel(view, funnel) {
    const name = prompt('Rename funnel', funnel.name);
    if (name == null || !name.trim()) return;
    act(view, () => api.funnels.saveFunnel({ short_guid: funnel.short_guid, name: name.trim() }), 'Renamed.');
}

async function reorder(view, funnel, from, to) {
    const order = (funnel.stages || []).map((s) => s.short_guid);
    const [m] = order.splice(from, 1);
    order.splice(to, 0, m);
    act(view, () => api.funnels.reorder(funnel.short_guid, order), 'Reordered.');
}

// Run a mutation, toast the result, and re-render (surfacing server-side guard errors).
async function act(view, thunk, okMsg) {
    try {
        const r = await thunk();
        if (r && r.error) { toast(r.error); return; }
        stageLabels(true); // stage labels may have changed - refresh the shared cache
        toast(okMsg); renderFunnels(view);
    } catch (e) { toast(e.message); }
}
