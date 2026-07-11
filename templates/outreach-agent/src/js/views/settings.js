import { api } from '../api.js';
import { el, setStatus, toast } from '../util.js';
import { loadSettings } from '../main.js';

// Global settings only. Anything audience- or message-shaped (the ask, the stages,
// the topics) lives per-stage in 4 - Funnel now, not here.
export async function renderSettings(view) {
    setStatus(view, 'Loading settings...');
    let s;
    try { s = (await api.settings.get()).settings || {}; }
    catch (e) { setStatus(view, `Could not load: ${e.message}`); return; }

    view.innerHTML = '';
    view.appendChild(el('h1', {}, 'Settings'));
    view.appendChild(el('p', { class: 'muted' },
        'Global setup. The per-stage ask, goals, and topics live in ', el('a', { href: '#/funnel' }, '4 - Funnel'), '.'));

    const field = (label, hint, input) => el('div', { style: 'margin-bottom:var(--space-md)' },
        el('label', { class: 'small' }, label), hint ? el('div', { class: 'muted small' }, hint) : null, input);

    const productName = el('input', { type: 'text', value: s.product_name || 'Gipity', style: 'width:100%' });
    const productUrl = el('input', { type: 'text', value: s.product_url || 'https://gipity.ai', style: 'width:100%' });
    const appUrl = el('input', { type: 'text', value: s.app_url || '', placeholder: 'https://app.gipity.ai/you/your-app', style: 'width:100%' });
    const senderName = el('input', { type: 'text', value: s.sender_name || '', style: 'width:100%' });
    const signature = el('input', { type: 'text', value: s.signature || '', style: 'width:100%' });
    const draftLead = el('input', { type: 'number', value: s.draft_lead_days ?? 1, min: 0, max: 7, style: 'width:100px' });
    const sendCap = el('input', { type: 'number', value: s.daily_send_cap ?? 10, min: 1, max: 10, style: 'width:100px' });
    const notifyEmail = el('input', { type: 'email', value: s.notify_email || '', placeholder: 'you@personal.com', style: 'width:100%' });
    const agentName = el('input', { type: 'text', value: s.agent_name || 'Outreach', style: 'width:100%' });
    const agentGuid = el('input', { type: 'text', value: s.agent_guid || '', placeholder: 'agt_xxxxxxxx', style: 'width:100%' });

    view.appendChild(el('div', { class: 'card' },
        el('div', { class: 'card-title' }, 'Voice & product'),
        field('Sender name', 'How you sign off (the agent\'s soul carries the real voice).', senderName),
        field('Signature', null, signature),
        field('Product name', null, productName),
        field('Product URL', null, productUrl),
    ));

    view.appendChild(el('div', { class: 'card' },
        el('div', { class: 'card-title' }, 'Schedule' ),
        el('p', { class: 'muted small' }, 'Recipients get a few touches ~3 days apart, then a monthly keep-warm, until they reply or unsubscribe.'),
        el('div', { class: 'row' },
            field('Draft lead (days)', 'Draft this many days early.', draftLead),
            field('Send cap / run', 'Max emails per send run.', sendCap),
        ),
        field('Reply alert email', 'Where reply alerts go (your personal inbox), and where check-replies scans.', notifyEmail),
        field('This app\'s public URL', 'Used to build the one-click unsubscribe link in every email (no trailing slash). While unset, emails fall back to "reply to unsubscribe".', appUrl),
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
                product_name: productName.value, product_url: productUrl.value,
                app_url: appUrl.value.trim().replace(/\/+$/, ''),
                sender_name: senderName.value, signature: signature.value,
                draft_lead_days: Number(draftLead.value),
                daily_send_cap: Number(sendCap.value), notify_email: notifyEmail.value,
                agent_name: agentName.value, agent_guid: agentGuid.value.trim(),
            });
            await loadSettings(true);
            toast('Settings saved.');
        } catch (e) { toast(e.message); }
    } }, 'Save settings'));
}
