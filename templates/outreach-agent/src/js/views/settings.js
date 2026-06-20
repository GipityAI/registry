import { api } from '../api.js';
import { el, esc, setStatus, toast } from '../util.js';
import { loadSettings } from '../main.js';

const CADENCES = ['every3', 'weekly', 'biweekly', 'monthly', 'paused'];

export async function renderSettings(view) {
    setStatus(view, 'Loading settings...');
    let s;
    try { s = (await api.settings.get()).settings || {}; }
    catch (e) { setStatus(view, `Could not load: ${e.message}`); return; }

    view.innerHTML = '';
    view.appendChild(el('h1', {}, 'Settings'));

    const field = (label, hint, input) => el('div', { style: 'margin-bottom:var(--space-md)' },
        el('label', { class: 'small' }, label), hint ? el('div', { class: 'muted small' }, hint) : null, input);

    const baseAsk = el('textarea', { style: 'width:100%;min-height:64px' }, s.base_ask || '');
    const productName = el('input', { type: 'text', value: s.product_name || 'Gipity', style: 'width:100%' });
    const productUrl = el('input', { type: 'text', value: s.product_url || 'https://gipity.ai', style: 'width:100%' });
    const senderName = el('input', { type: 'text', value: s.sender_name || '', style: 'width:100%' });
    const signature = el('input', { type: 'text', value: s.signature || '', style: 'width:100%' });
    const cadence = el('select', {}, ...CADENCES.map((x) => el('option', { value: x, selected: x === (s.default_cadence || 'every3') }, x)));
    const draftLead = el('input', { type: 'number', value: s.draft_lead_days ?? 1, min: 0, max: 7, style: 'width:100px' });
    const sendCap = el('input', { type: 'number', value: s.daily_send_cap ?? 10, min: 1, max: 10, style: 'width:100px' });
    const notifyEmail = el('input', { type: 'email', value: s.notify_email || '', placeholder: 'you@personal.com', style: 'width:100%' });
    const agentName = el('input', { type: 'text', value: s.agent_name || 'Outreach', style: 'width:100%' });
    const agentGuid = el('input', { type: 'text', value: s.agent_guid || '', placeholder: 'agt_xxxxxxxx', style: 'width:100%' });

    view.appendChild(el('div', { class: 'card' },
        el('div', { class: 'card-title' }, 'The ask'),
        field('Base ask', 'What every email is ultimately for. The agent personalizes around this.', baseAsk),
        field('Product name', null, productName),
        field('Product URL', null, productUrl),
    ));

    view.appendChild(el('div', { class: 'card' },
        el('div', { class: 'card-title' }, 'Voice & schedule'),
        field('Sender name', 'How you sign off (the agent\'s soul carries the real voice).', senderName),
        field('Signature', null, signature),
        field('Default cadence', 'Every 3 days by default; override per contact on their page.', cadence),
        el('div', { class: 'row' },
            field('Draft lead (days)', 'Draft this many days early.', draftLead),
            field('Daily send cap', 'Max emails per send run (limit 10).', sendCap),
        ),
        field('Reply alert email', 'Where reply alerts go (your personal inbox). Outreach sends use this as reply-to so replies land where check-replies scans.', notifyEmail),
    ));

    view.appendChild(el('div', { class: 'card' },
        el('div', { class: 'card-title' }, 'The agent'),
        el('p', { class: 'muted small' }, 'Create an agent named exactly this on ', el('a', { href: 'https://prompt.gipity.ai', target: '_blank', rel: 'noopener' }, 'Gipity'), ', set its soul (your voice) + goal, then paste its short_guid here so the Playbook and comment-to-learn loop work.'),
        field('Agent name', 'Must match the agent the workflows bind to (agent: Outreach).', agentName),
        field('Agent short_guid', 'From the agent\'s page on Gipity.', agentGuid),
    ));

    view.appendChild(el('button', { onclick: async () => {
        try {
            await api.settings.save({
                base_ask: baseAsk.value, product_name: productName.value, product_url: productUrl.value,
                sender_name: senderName.value, signature: signature.value,
                default_cadence: cadence.value, draft_lead_days: Number(draftLead.value),
                daily_send_cap: Number(sendCap.value), notify_email: notifyEmail.value,
                agent_name: agentName.value, agent_guid: agentGuid.value.trim(),
            });
            await loadSettings(true);
            toast('Settings saved.');
        } catch (e) { toast(e.message); }
    } }, 'Save settings'));
}
