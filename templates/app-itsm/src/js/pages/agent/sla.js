// pages/agent/sla.js - SLA dashboard with stat cards and live countdown timers

import { listRecords } from '../../api.js';
import { el, formatSlaRemaining, formatDateTime, escapeHtml, stateBadge } from '../../utils.js';

let refreshInterval = null;

export function renderSla() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <div class="page-header">
            <h1>SLA Dashboard</h1>
            <div class="page-header-actions">
                <span id="sla-last-refresh" style="font-size: var(--text-xs); color: var(--text-faint);"></span>
                <button class="btn btn-sm" id="btn-refresh-sla">Refresh</button>
            </div>
        </div>
        <div class="page-body">
            <div class="dashboard-grid" id="sla-stats">
                <div class="card">
                    <div class="card-title">Active SLAs</div>
                    <div class="card-value" id="stat-active"><span class="spinner"></span></div>
                </div>
                <div class="card">
                    <div class="card-title">At Risk (&gt;75%)</div>
                    <div class="card-value" id="stat-at-risk" style="color: var(--warning);"><span class="spinner"></span></div>
                </div>
                <div class="card">
                    <div class="card-title">Breached</div>
                    <div class="card-value" id="stat-breached" style="color: var(--danger);"><span class="spinner"></span></div>
                </div>
            </div>

            <div style="margin-top: var(--sp-6);">
                <h2 class="section-title">Active SLA Timers</h2>
                <div id="sla-table-container">
                    <div class="skeleton skeleton-box"></div>
                </div>
            </div>
        </div>
    `;

    loadSlaData();

    document.getElementById('btn-refresh-sla')?.addEventListener('click', loadSlaData);

    // Auto-refresh every 60 seconds
    refreshInterval = setInterval(loadSlaData, 60000);

    return () => {
        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
        }
    };
}

async function loadSlaData() {
    const refreshLabel = document.getElementById('sla-last-refresh');
    if (refreshLabel) {
        refreshLabel.textContent = `Last refresh: ${new Date().toLocaleTimeString()}`;
    }

    try {
        // Load all active SLA tasks
        const activeResult = await listRecords('sla_tasks', {
            filters: { state: 'in_progress' },
            sort: { target_time: 'asc' },
            limit: 100,
        });
        const activeTasks = activeResult?.rows || activeResult?.data || [];

        // Load breached tasks
        const breachedResult = await listRecords('sla_tasks', {
            filters: { is_breached: true },
            limit: 0,
        });

        // Calculate stats
        const activeCount = activeTasks.length;
        const atRiskCount = activeTasks.filter((t) => {
            const remaining = formatSlaRemaining(t.target_time);
            return remaining.status === 'warning' && !t.is_breached;
        }).length;
        const breachedCount = breachedResult?.total ?? activeTasks.filter((t) => t.is_breached).length;

        // Update stat cards
        document.getElementById('stat-active').textContent = activeCount;
        document.getElementById('stat-at-risk').textContent = atRiskCount;
        document.getElementById('stat-breached').textContent = breachedCount;

        // Render table
        renderSlaTable(activeTasks);
    } catch (err) {
        console.error('Failed to load SLA data:', err);
        document.getElementById('stat-active').textContent = '--';
        document.getElementById('stat-at-risk').textContent = '--';
        document.getElementById('stat-breached').textContent = '--';
        document.getElementById('sla-table-container').innerHTML =
            '<div class="empty-state"><p>Failed to load SLA data</p></div>';
    }
}

function renderSlaTable(tasks) {
    const container = document.getElementById('sla-table-container');
    if (!container) return;

    if (tasks.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No active SLA timers</p></div>';
        return;
    }

    const table = el('table', { className: 'data-table' });
    table.innerHTML = `
        <thead>
            <tr>
                <th>Incident</th>
                <th>Type</th>
                <th>State</th>
                <th>Target Time</th>
                <th>Remaining</th>
                <th>Status</th>
            </tr>
        </thead>
    `;

    const tbody = el('tbody');
    tasks.forEach((task) => {
        const remaining = formatSlaRemaining(task.target_time);
        const statusClass = task.is_breached ? 'sla-breached' : remaining.status === 'warning' ? 'sla-warning' : 'sla-ok';

        const tr = el('tr');
        tr.innerHTML = `
            <td>${escapeHtml(task.incident_number || `#${task.incident_id}`)}</td>
            <td>${escapeHtml(task.target_type || '--')}</td>
            <td>${stateBadge(task.state)}</td>
            <td style="font-size: var(--text-xs);">${formatDateTime(task.target_time)}</td>
            <td>
                <span class="sla-badge ${statusClass}">${task.is_breached ? 'BREACHED' : remaining.text}</span>
            </td>
            <td>
                ${task.is_breached
                    ? '<span style="color: var(--danger); font-size: var(--text-xs);">Breached</span>'
                    : task.paused_at
                        ? '<span style="color: var(--warning); font-size: var(--text-xs);">Paused</span>'
                        : '<span style="color: var(--success); font-size: var(--text-xs);">Running</span>'
                }
            </td>
        `;
        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.innerHTML = '';
    container.appendChild(table);
}
