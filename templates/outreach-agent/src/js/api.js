// Two backends, two clients:
//   1) app functions  - window.Gipity.fn(name, body): this app's own data plane.
//   2) the platform bridge - /account/agents/:guid/{rules,learn} on a.gipity.ai,
//      authed by the SAME Sign-in-with-Gipity session cookie the SDK lands. We call
//      it directly with credentials:'include' so the dashboard can show the agent's
//      growing playbook and teach it from your comments.

const fn = (name, body) => window.Gipity.fn(name, body);

const PLATFORM = 'https://a.gipity.ai';
async function bridge(method, path, body) {
    const res = await fetch(`${PLATFORM}${path}`, {
        method,
        credentials: 'include',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw new Error('UNAUTHENTICATED');
    if (res.status === 404) throw new Error('Agent not found - check the agent short_guid in Settings.');
    if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error?.message || `Bridge ${res.status}`);
    }
    return res.json();
}

export const api = {
    dashboard: () => fn('dashboard'),

    contacts: {
        list: (body = {}) => fn('contacts', { op: 'list', ...body }),
        get: (contact_guid) => fn('contacts', { op: 'get', contact_guid }),
        save: (contact) => fn('contacts', { op: 'save', ...contact }),
        remove: (contact_guid) => fn('contacts', { op: 'delete', contact_guid }),
        dueNow: (contact_guid) => fn('contacts', { op: 'due_now', contact_guid }),
    },

    candidates: {
        list: () => fn('candidates', { op: 'list' }),
        approve: (contact_guid) => fn('candidates', { op: 'approve', contact_guid }),
        reject: (contact_guid) => fn('candidates', { op: 'reject', contact_guid }),
        approveAll: () => fn('candidates', { op: 'approve_all' }),
    },

    knowledge: {
        add: (contact_guid, content) => fn('knowledge', { op: 'add', contact_guid, content }),
        remove: (knowledge_guid) => fn('knowledge', { op: 'delete', knowledge_guid }),
    },

    review: {
        queue: () => fn('review', { op: 'queue' }),
        approve: (message_guid, edited) => fn('review', { op: 'decide', action: 'approve', message_guid, ...edited }),
        reject: (message_guid, reject_reason) => fn('review', { op: 'decide', action: 'reject', message_guid, reject_reason }),
        comment: (message_guid, comment) => fn('review', { op: 'decide', action: 'comment', message_guid, comment }),
    },

    settings: {
        get: () => fn('settings', { op: 'get' }),
        save: (s) => fn('settings', { op: 'save', ...s }),
    },

    topics: {
        list: (stage_guid) => fn('topics', stage_guid ? { op: 'list', stage_guid } : { op: 'list' }),
        save: (t) => fn('topics', { op: 'save', ...t }),
        toggle: (short_guid) => fn('topics', { op: 'toggle', short_guid }),
        remove: (short_guid) => fn('topics', { op: 'delete', short_guid }),
    },

    // Funnels + their ordered stages (each stage: goal, ask, topics, recipients).
    funnels: {
        list: () => fn('funnels', { op: 'list' }),
        saveFunnel: (f) => fn('funnels', { op: 'save_funnel', ...f }),
        setDefault: (short_guid) => fn('funnels', { op: 'set_default', short_guid }),
        removeFunnel: (short_guid) => fn('funnels', { op: 'delete_funnel', short_guid }),
        saveStage: (s) => fn('funnels', { op: 'save_stage', ...s }),
        removeStage: (short_guid) => fn('funnels', { op: 'delete_stage', short_guid }),
        reorder: (funnel_guid, order) => fn('funnels', { op: 'reorder_stages', funnel_guid, order }),
    },

    linkedinImport: (rows) => fn('linkedin-import', { rows }),
    signupsImport: (rows) => fn('signups-import', { rows }),

    // Platform bridge - admin-only export of Gipity signups + the waitlist (the full
    // audience). The same Sign-in-with-Gipity session cookie authorizes it; only an
    // admin account gets data.
    accounts: {
        list: (params = {}) => {
            const qs = new URLSearchParams(params).toString();
            return bridge('GET', `/account/accounts${qs ? `?${qs}` : ''}`);
        },
        waitlist: () => bridge('GET', '/account/accounts/waitlist'),
    },

    // Platform bridge - the agent's playbook + learning.
    rules: {
        list: (agentGuid) => bridge('GET', `/account/agents/${agentGuid}/rules`),
        seed: (agentGuid, rules) => bridge('POST', `/account/agents/${agentGuid}/rules`, { rules }),
        remove: (agentGuid, ruleGuid) => bridge('DELETE', `/account/agents/${agentGuid}/rules/${ruleGuid}`),
        learn: (agentGuid, original, comment) => bridge('POST', `/account/agents/${agentGuid}/learn`, { original, comment }),
    },
};
