// pages/agent/incidents.js - Split-pane incident list + detail with tabs

import { listRecords, getRecord, updateRecord, listComments, addComment, callFunction, subscribeSSE } from '../../api.js';
import { el, timeAgo, priorityInfo, stateBadge, escapeHtml, showToast, formatSlaRemaining, formatDateTime } from '../../utils.js';
import { navigate } from '../../router.js';

let selectedId = null;
let currentFilter = 'open';
let sseSubscription = null;

const FILTERS = {
    open: { label: 'All Open', filters: { state: ['new', 'in_progress', 'on_hold'] } },
    mine: { label: 'Assigned to Me', filters: { state: ['new', 'in_progress', 'on_hold'] } },
    unassigned: { label: 'Unassigned', filters: { state: ['new', 'in_progress'], assigned_to: null } },
    major: { label: 'Major', filters: { is_major: true, state: ['new', 'in_progress', 'on_hold'] } },
    resolved: { label: 'Resolved', filters: { state: ['resolved', 'closed'] } },
};

export function renderIncidents() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <div class="page-header">
            <h1>Incidents</h1>
            <div class="page-header-actions">
                <a href="/agent/incidents/new" data-link class="btn btn-primary">New Incident</a>
            </div>
        </div>
        <div class="split-pane">
            <div class="split-list">
                <div class="split-list-header">
                    <div class="search-bar">
                        <input type="text" id="incident-search" placeholder="Search incidents...">
                    </div>
                    <div class="filter-bar" id="incident-filters"></div>
                </div>
                <div class="split-list-body" id="incident-list">
                    <div class="skeleton skeleton-box" style="margin: var(--sp-3);"></div>
                </div>
            </div>
            <div class="split-detail" id="incident-detail">
                <div class="split-detail-empty">Select an incident to view details</div>
            </div>
        </div>
    `;

    renderFilters();
    loadIncidentList();

    // SSE for live updates
    sseSubscription = subscribeSSE('incidents', (event) => {
        loadIncidentList();
        if (selectedId && event.id === selectedId) {
            loadIncidentDetail(selectedId);
        }
    });

    // Return cleanup function
    return () => {
        if (sseSubscription) {
            sseSubscription.close();
            sseSubscription = null;
        }
    };
}

function renderFilters() {
    const container = document.getElementById('incident-filters');
    if (!container) return;
    container.innerHTML = '';

    Object.entries(FILTERS).forEach(([key, { label }]) => {
        const chip = el('button', {
            className: `filter-chip ${key === currentFilter ? 'active' : ''}`,
            onClick: () => {
                currentFilter = key;
                renderFilters();
                loadIncidentList();
            },
        }, label);
        container.appendChild(chip);
    });
}

async function loadIncidentList() {
    const container = document.getElementById('incident-list');
    if (!container) return;

    try {
        const filterConfig = FILTERS[currentFilter];
        const result = await listRecords('incidents', {
            filters: filterConfig.filters,
            sort: { priority: 'asc', created_at: 'desc' },
            limit: 50,
        });

        const items = result?.rows || result?.data || [];
        if (items.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No incidents match this filter</p></div>';
            return;
        }

        container.innerHTML = '';
        items.forEach((inc) => {
            const pi = priorityInfo(inc.priority);
            const row = el('div', {
                className: `ticket-row ${inc.id === selectedId ? 'selected' : ''}`,
                onClick: () => {
                    selectedId = inc.id;
                    loadIncidentDetail(inc.id);
                    // Update selection visual
                    container.querySelectorAll('.ticket-row').forEach((r) => r.classList.remove('selected'));
                    row.classList.add('selected');
                },
            });
            row.innerHTML = `
                <div class="ticket-row-header">
                    <span class="ticket-row-number">${escapeHtml(inc.number)}</span>
                    <span class="state-badge ${pi.badgeClass}" style="font-size: 10px;">${pi.label}</span>
                </div>
                <div class="ticket-row-title">${escapeHtml(inc.short_description)}</div>
                <div class="ticket-row-meta">
                    <span>${stateBadge(inc.state)}</span>
                    <span>${timeAgo(inc.created_at)}</span>
                    ${inc.assigned_to ? `<span>Assigned</span>` : '<span style="color: var(--warning);">Unassigned</span>'}
                </div>
            `;
            container.appendChild(row);
        });
    } catch (err) {
        console.error('Failed to load incidents:', err);
        container.innerHTML = '<div class="empty-state"><p>Failed to load incidents</p></div>';
    }
}

async function loadIncidentDetail(id) {
    const container = document.getElementById('incident-detail');
    if (!container) return;

    container.innerHTML = '<div style="padding: var(--sp-6); text-align: center;"><span class="spinner spinner-lg"></span></div>';

    try {
        const result = await getRecord('incidents', id);
        const inc = result?.row || result?.data || result;
        if (!inc) {
            container.innerHTML = '<div class="empty-state"><p>Incident not found</p></div>';
            return;
        }

        const pi = priorityInfo(inc.priority);

        container.innerHTML = `
            <div style="padding: var(--sp-4) var(--sp-6); border-bottom: 1px solid var(--border); background: var(--bg-surface);">
                <div style="display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-2);">
                    <span style="color: var(--text-muted); font-size: var(--text-sm);">${escapeHtml(inc.number)}</span>
                    ${stateBadge(inc.state)}
                    <span class="state-badge ${pi.badgeClass}">${pi.label}</span>
                    ${inc.is_major ? '<span class="state-badge" style="background: var(--danger-muted); color: var(--danger);">MAJOR</span>' : ''}
                </div>
                <h2 style="font-size: var(--text-md);">${escapeHtml(inc.short_description)}</h2>
                <div style="margin-top: var(--sp-3); display: flex; gap: var(--sp-2);">
                    <select class="form-select btn-sm" id="detail-state" style="width: auto;">
                        ${['new', 'in_progress', 'on_hold', 'resolved', 'closed'].map(
                            (s) => `<option value="${s}" ${s === inc.state ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`
                        ).join('')}
                    </select>
                    <button class="btn btn-sm btn-primary" id="btn-update-state">Update</button>
                </div>
            </div>

            <div class="tabs" id="detail-tabs">
                <button class="tab active" data-tab="details">Details</button>
                <button class="tab" data-tab="activity">Activity</button>
                <button class="tab" data-tab="sla">SLA</button>
                <button class="tab" data-tab="ai">AI</button>
            </div>

            <div class="tab-content active" id="tab-details">
                <div class="field-grid">
                    <div class="field-item">
                        <span class="field-label">Impact</span>
                        <span class="field-value">${inc.impact}</span>
                    </div>
                    <div class="field-item">
                        <span class="field-label">Urgency</span>
                        <span class="field-value">${inc.urgency}</span>
                    </div>
                    <div class="field-item">
                        <span class="field-label">Priority</span>
                        <span class="field-value ${pi.className}">${pi.label} (P${inc.priority})</span>
                    </div>
                    <div class="field-item">
                        <span class="field-label">Caller</span>
                        <span class="field-value">${escapeHtml(inc.caller_name || inc.caller_id || '--')}</span>
                    </div>
                    <div class="field-item">
                        <span class="field-label">Contact Type</span>
                        <span class="field-value">${escapeHtml(inc.contact_type || '--')}</span>
                    </div>
                    <div class="field-item">
                        <span class="field-label">Assigned To</span>
                        <span class="field-value">${escapeHtml(inc.assigned_to || 'Unassigned')}</span>
                    </div>
                    <div class="field-item">
                        <span class="field-label">Team</span>
                        <span class="field-value">${escapeHtml(inc.team_name || inc.team_id || '--')}</span>
                    </div>
                    <div class="field-item">
                        <span class="field-label">Category</span>
                        <span class="field-value">${escapeHtml(inc.category_name || '--')}</span>
                    </div>
                    <div class="field-item">
                        <span class="field-label">Created</span>
                        <span class="field-value">${formatDateTime(inc.created_at)}</span>
                    </div>
                    <div class="field-item">
                        <span class="field-label">Updated</span>
                        <span class="field-value">${formatDateTime(inc.updated_at)}</span>
                    </div>
                    <div class="field-item">
                        <span class="field-label">Escalation Level</span>
                        <span class="field-value">${inc.escalation_level || 0}</span>
                    </div>
                    <div class="field-item">
                        <span class="field-label">Reopen Count</span>
                        <span class="field-value">${inc.reopen_count || 0}</span>
                    </div>
                </div>
                ${inc.description ? `<div style="margin-top: var(--sp-4);"><span class="field-label">Description</span><div style="margin-top: var(--sp-2); font-size: var(--text-sm); color: var(--text-secondary); white-space: pre-wrap;">${escapeHtml(inc.description)}</div></div>` : ''}
                ${inc.resolution_notes ? `<div style="margin-top: var(--sp-4);"><span class="field-label">Resolution Notes</span><div style="margin-top: var(--sp-2); font-size: var(--text-sm); color: var(--text-secondary); white-space: pre-wrap;">${escapeHtml(inc.resolution_notes)}</div></div>` : ''}
            </div>

            <div class="tab-content" id="tab-activity">
                <div style="margin-bottom: var(--sp-4);">
                    <textarea class="form-textarea" id="comment-input" placeholder="Add a comment..." rows="3"></textarea>
                    <div style="margin-top: var(--sp-2); display: flex; gap: var(--sp-2);">
                        <button class="btn btn-sm btn-primary" id="btn-add-comment">Add Comment</button>
                        <button class="btn btn-sm" id="btn-add-worknote">Add Work Note</button>
                    </div>
                </div>
                <div class="activity-feed" id="activity-feed">
                    <div class="skeleton skeleton-box"></div>
                </div>
            </div>

            <div class="tab-content" id="tab-sla">
                <div id="sla-timers">
                    <div class="skeleton skeleton-box"></div>
                </div>
            </div>

            <div class="tab-content" id="tab-ai">
                <div style="margin-bottom: var(--sp-4);">
                    <button class="btn btn-primary" id="btn-suggest-resolution">Suggest Resolution</button>
                </div>
                ${inc.ai_confidence ? `
                    <div class="card" style="margin-bottom: var(--sp-4);">
                        <div class="card-title">AI Classification</div>
                        <div style="margin-top: var(--sp-2); font-size: var(--text-sm);">
                            <p>Confidence: <strong>${Math.round(inc.ai_confidence * 100)}%</strong></p>
                            ${inc.ai_suggested_category ? `<p>Suggested Category: ${escapeHtml(inc.ai_suggested_category)}</p>` : ''}
                            ${inc.ai_suggested_team ? `<p>Suggested Team: ${escapeHtml(inc.ai_suggested_team)}</p>` : ''}
                        </div>
                    </div>
                ` : ''}
                <div id="ai-suggestion-result"></div>
            </div>
        `;

        // Tab switching
        container.querySelectorAll('.tab').forEach((tab) => {
            tab.addEventListener('click', () => {
                container.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
                container.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
                tab.classList.add('active');
                const target = document.getElementById(`tab-${tab.dataset.tab}`);
                if (target) target.classList.add('active');
            });
        });

        // State update
        document.getElementById('btn-update-state')?.addEventListener('click', async () => {
            const newState = document.getElementById('detail-state')?.value;
            if (!newState) return;
            try {
                await updateRecord('incidents', id, { state: newState });
                showToast('State updated', 'success');
                loadIncidentDetail(id);
                loadIncidentList();
            } catch (err) {
                showToast('Failed to update state', 'error');
            }
        });

        // Comments
        loadComments(id);
        document.getElementById('btn-add-comment')?.addEventListener('click', () => submitComment(id, 'comment'));
        document.getElementById('btn-add-worknote')?.addEventListener('click', () => submitComment(id, 'work_note'));

        // SLA
        loadSlaTimers(id);

        // AI suggestion
        document.getElementById('btn-suggest-resolution')?.addEventListener('click', () => suggestResolution(id));

    } catch (err) {
        console.error('Failed to load incident:', err);
        container.innerHTML = '<div class="empty-state"><p>Failed to load incident details</p></div>';
    }
}

async function loadComments(incidentId) {
    const feed = document.getElementById('activity-feed');
    if (!feed) return;

    try {
        const result = await listComments('incidents', incidentId);
        const items = result?.rows || result?.data || [];

        if (items.length === 0) {
            feed.innerHTML = '<div class="empty-state"><p>No activity yet</p></div>';
            return;
        }

        feed.innerHTML = '';
        items.forEach((c) => {
            const item = el('div', {
                className: `activity-item ${c.is_ai_generated ? 'ai-generated' : ''}`,
            });
            item.innerHTML = `
                <div class="activity-item-header">
                    <span>${escapeHtml(c.author_name || 'System')} ${c.comment_type === 'work_note' ? '(work note)' : ''}</span>
                    <span>${timeAgo(c.created_at)}</span>
                </div>
                <div class="activity-item-body">${escapeHtml(c.body)}</div>
            `;
            feed.appendChild(item);
        });
    } catch (err) {
        feed.innerHTML = '<p style="color: var(--text-faint); padding: var(--sp-3);">Failed to load comments</p>';
    }
}

async function submitComment(incidentId, type) {
    const input = document.getElementById('comment-input');
    const body = input?.value?.trim();
    if (!body) return;

    try {
        await addComment('incidents', incidentId, body, type);
        input.value = '';
        showToast('Comment added', 'success');
        loadComments(incidentId);
    } catch (err) {
        showToast('Failed to add comment', 'error');
    }
}

async function loadSlaTimers(incidentId) {
    const container = document.getElementById('sla-timers');
    if (!container) return;

    try {
        const result = await listRecords('sla_tasks', {
            filters: { incident_id: incidentId },
        });
        const tasks = result?.rows || result?.data || [];

        if (tasks.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No SLA tasks assigned</p></div>';
            return;
        }

        container.innerHTML = '';
        tasks.forEach((task) => {
            const remaining = formatSlaRemaining(task.target_time);
            const statusClass = task.is_breached ? 'sla-breached' : remaining.status === 'warning' ? 'sla-warning' : 'sla-ok';

            const card = el('div', { className: 'card', style: 'margin-bottom: var(--sp-3);' });
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div class="field-label">${escapeHtml(task.target_type || 'SLA')} Target</div>
                        <div style="font-size: var(--text-sm); margin-top: var(--sp-1);">
                            ${stateBadge(task.state)}
                        </div>
                    </div>
                    <div class="sla-badge ${statusClass}" style="font-size: var(--text-base); padding: var(--sp-2) var(--sp-3);">
                        ${task.is_breached ? 'BREACHED' : remaining.text}
                    </div>
                </div>
                <div style="margin-top: var(--sp-2); font-size: var(--text-xs); color: var(--text-faint);">
                    Target: ${formatDateTime(task.target_time)}
                </div>
            `;
            container.appendChild(card);
        });
    } catch (err) {
        container.innerHTML = '<p style="color: var(--text-faint); padding: var(--sp-3);">Failed to load SLA data</p>';
    }
}

async function suggestResolution(incidentId) {
    const container = document.getElementById('ai-suggestion-result');
    if (!container) return;

    container.innerHTML = '<span class="spinner"></span> Analyzing incident and searching knowledge base...';

    try {
        const result = await callFunction('suggest-resolution', { incident_id: incidentId });
        const suggestion = result?.suggestion || result?.data?.suggestion || 'No suggestions available.';

        container.innerHTML = `
            <div class="card">
                <div class="card-title">AI Suggestion</div>
                <div style="margin-top: var(--sp-2); font-size: var(--text-sm); color: var(--text-secondary); white-space: pre-wrap; line-height: 1.7;">
                    ${escapeHtml(suggestion)}
                </div>
            </div>
        `;
    } catch (err) {
        console.error('AI suggestion failed:', err);
        container.innerHTML = '<p style="color: var(--danger); font-size: var(--text-sm);">Failed to generate suggestion.</p>';
    }
}
