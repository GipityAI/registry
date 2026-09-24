// pages/portal/my-requests.js - Combined view of incidents + service requests with pipeline progress

import { listRecords } from '../../api.js';
import { el, escapeHtml, timeAgo, stateBadge, formatDate } from '../../utils.js';
import { initTabs } from '../../components/tabs.js';

let currentTab = 'active';

const INCIDENT_STATES = ['new', 'in_progress', 'on_hold', 'resolved', 'closed'];
const REQUEST_STATES = ['pending', 'approved', 'in_progress', 'fulfilled', 'closed'];

export function renderMyRequests() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <div class="portal-layout">
            <div style="margin-bottom: var(--sp-4);">
                <a href="/" data-link style="font-size: var(--text-sm); color: var(--text-muted);">&larr; Back to Portal</a>
            </div>
            <h1 style="margin-bottom: var(--sp-6);">My Requests</h1>

            <div class="tabs" id="request-tabs">
                <button class="tab active" data-tab="active">Active</button>
                <button class="tab" data-tab="closed">Closed</button>
            </div>

            <div style="padding-top: var(--sp-4);" id="requests-body">
                <div class="skeleton skeleton-box"></div>
            </div>
        </div>
    `;

    initTabs(main, 'tab', (key) => { currentTab = key; loadRequests(); });
    loadRequests();
}

async function loadRequests() {
    const body = document.getElementById('requests-body');
    if (!body) return;

    body.innerHTML = '<div style="text-align: center; padding: var(--sp-6);"><span class="spinner spinner-lg"></span></div>';

    try {
        const activeStatesInc = currentTab === 'active'
            ? ['new', 'in_progress', 'on_hold']
            : ['resolved', 'closed'];
        const activeStatesReq = currentTab === 'active'
            ? ['pending', 'approved', 'in_progress']
            : ['fulfilled', 'closed', 'rejected', 'cancelled'];

        const [incResult, reqResult] = await Promise.all([
            listRecords('incidents', {
                filters: { state: activeStatesInc },
                sort: { created_at: 'desc' },
                limit: 25,
            }),
            listRecords('service_requests', {
                filters: { state: activeStatesReq },
                sort: { created_at: 'desc' },
                limit: 25,
            }),
        ]);

        const incidents = (incResult?.rows || incResult?.data || []).map((i) => ({ ...i, _type: 'incident' }));
        const requests = (reqResult?.rows || reqResult?.data || []).map((r) => ({ ...r, _type: 'request' }));

        // Combine and sort by created_at desc
        const combined = [...incidents, ...requests].sort(
            (a, b) => new Date(b.created_at) - new Date(a.created_at)
        );

        if (combined.length === 0) {
            body.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">${currentTab === 'active' ? '&#10003;' : '&#128193;'}</div>
                    <p>${currentTab === 'active' ? 'No active requests. You\'re all set!' : 'No closed requests found.'}</p>
                </div>
            `;
            return;
        }

        body.innerHTML = '';
        combined.forEach((item) => {
            const card = el('div', { className: 'card', style: 'margin-bottom: var(--sp-3);' });

            const isIncident = item._type === 'incident';
            const number = item.number || '--';
            const title = isIncident ? item.short_description : (item.catalog_item_name || 'Service Request');
            const states = isIncident ? INCIDENT_STATES : REQUEST_STATES;
            const currentState = item.state;
            const currentIdx = states.indexOf(currentState);

            // Build pipeline visualization
            const pipelineHtml = states.map((s, i) => {
                let cls = 'pipeline-step';
                if (i < currentIdx) cls += ' complete';
                else if (i === currentIdx) cls += ' current';
                return `<div class="${cls}" title="${s.replace(/_/g, ' ')}"></div>`;
            }).join('');

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--sp-2);">
                    <div>
                        <div style="display: flex; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-1);">
                            <span style="font-size: var(--text-xs); color: var(--text-muted);">${escapeHtml(number)}</span>
                            <span class="state-badge" style="font-size: 10px; background: var(--bg-hover); color: var(--text-faint);">
                                ${isIncident ? 'Incident' : 'Request'}
                            </span>
                            ${stateBadge(currentState)}
                        </div>
                        <div style="font-size: var(--text-sm); color: var(--text-primary);">${escapeHtml(title)}</div>
                    </div>
                    <span style="font-size: var(--text-xs); color: var(--text-faint); white-space: nowrap;">${timeAgo(item.created_at)}</span>
                </div>
                <div class="pipeline">${pipelineHtml}</div>
                <div style="display: flex; justify-content: space-between; margin-top: var(--sp-2); font-size: var(--text-xs); color: var(--text-faint);">
                    <span>Created ${formatDate(item.created_at)}</span>
                    ${item.fulfilled_at ? `<span>Fulfilled ${formatDate(item.fulfilled_at)}</span>` : ''}
                    ${item.resolved_at ? `<span>Resolved ${formatDate(item.resolved_at)}</span>` : ''}
                    ${!isIncident && item.approval_state === 'pending' ? '<span style="color: var(--warning);">Awaiting Approval</span>' : ''}
                </div>
            `;

            body.appendChild(card);
        });
    } catch (err) {
        console.error('Failed to load requests:', err);
        body.innerHTML = '<div class="empty-state"><p>Failed to load your requests. Please try again.</p></div>';
    }
}
