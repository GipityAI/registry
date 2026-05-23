// pages/agent/home.js - Agent dashboard with stats, recent incidents, AI shift summary

import { listRecords, aggregateRecords, callLLM } from '../../api.js';
import { timeAgo, priorityInfo, stateBadge, showToast, escapeHtml } from '../../utils.js';
import { navigate } from '../../router.js';

export function renderAgentHome() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <div class="page-header">
            <h1>Dashboard</h1>
            <div class="page-header-actions">
                <button class="btn" id="btn-shift-summary">AI Shift Summary</button>
                <a href="/agent/incidents/new" data-link class="btn btn-primary">New Incident</a>
            </div>
        </div>
        <div class="page-body">
            <div class="dashboard-grid" id="stats-grid">
                <div class="card">
                    <div class="card-title">My Open Work</div>
                    <div class="card-value" id="stat-my-work"><span class="spinner"></span></div>
                </div>
                <div class="card">
                    <div class="card-title">Unassigned</div>
                    <div class="card-value" id="stat-unassigned"><span class="spinner"></span></div>
                </div>
                <div class="card">
                    <div class="card-title">SLA At Risk</div>
                    <div class="card-value" id="stat-sla-risk"><span class="spinner"></span></div>
                </div>
                <div class="card">
                    <div class="card-title">Resolved Today</div>
                    <div class="card-value" id="stat-resolved"><span class="spinner"></span></div>
                </div>
            </div>

            <div style="margin-top: var(--sp-6);">
                <h2 class="section-title">Recent Incidents</h2>
                <div id="recent-incidents"><span class="spinner"></span></div>
            </div>

            <div id="shift-summary-container" style="margin-top: var(--sp-6); display: none;">
                <h2 class="section-title">AI Shift Summary</h2>
                <div class="card" id="shift-summary-content"></div>
            </div>
        </div>
    `;

    loadStats();
    loadRecentIncidents();
    document.getElementById('btn-shift-summary')?.addEventListener('click', loadShiftSummary);
}

async function loadStats() {
    try {
        const open = await listRecords('incidents', { filter: 'state:in:new,in_progress', limit: 0 });
        document.getElementById('stat-my-work').textContent = open.total ?? 0;

        const unassigned = await listRecords('incidents', { filter: 'state:in:new,in_progress,assigned_to:is:null', limit: 0 });
        document.getElementById('stat-unassigned').textContent = unassigned.total ?? 0;

        const sla = await listRecords('sla_tasks', { filter: 'state:eq:in_progress', limit: 0 });
        document.getElementById('stat-sla-risk').textContent = sla.total ?? 0;

        const today = new Date().toISOString().split('T')[0];
        const resolved = await listRecords('incidents', { filter: `state:eq:resolved,resolved_at:gte:${today}`, limit: 0 });
        document.getElementById('stat-resolved').textContent = resolved.total ?? 0;
    } catch (err) {
        console.error('Failed to load stats:', err);
        ['stat-my-work', 'stat-unassigned', 'stat-sla-risk', 'stat-resolved'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '--';
        });
    }
}

async function loadRecentIncidents() {
    const container = document.getElementById('recent-incidents');
    try {
        const result = await listRecords('incidents', {
            filter: 'state:in:new,in_progress,on_hold',
            sort: '-priority,-created_at',
            limit: 10,
        });
        const items = result.data;

        if (items.length === 0) {
            container.innerHTML = `<div class="empty-state">
                <p>No open incidents</p>
                <a href="/agent/incidents/new" data-link class="btn btn-primary" style="margin-top: var(--sp-3);">Create your first incident</a>
            </div>`;
            return;
        }

        container.innerHTML = `<table class="data-table">
            <thead><tr><th>Number</th><th>Summary</th><th>Priority</th><th>State</th><th>Created</th></tr></thead>
            <tbody>${items.map(inc => {
                const pi = priorityInfo(inc.priority);
                return `<tr data-id="${inc.id}" style="cursor:pointer">
                    <td><span style="color:var(--primary)">${escapeHtml(inc.number || '#' + inc.id)}</span></td>
                    <td>${escapeHtml(inc.short_description)}</td>
                    <td><span class="${pi.className}">${pi.label}</span></td>
                    <td>${stateBadge(inc.state)}</td>
                    <td>${timeAgo(inc.created_at)}</td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;

        container.querySelectorAll('tr[data-id]').forEach(tr => {
            tr.addEventListener('click', () => navigate(`/agent/incidents/${tr.dataset.id}`));
        });
    } catch (err) {
        console.error('Failed to load incidents:', err);
        container.innerHTML = '<div class="empty-state"><p>Failed to load incidents</p></div>';
    }
}

async function loadShiftSummary() {
    const container = document.getElementById('shift-summary-container');
    const content = document.getElementById('shift-summary-content');
    const btn = document.getElementById('btn-shift-summary');

    container.style.display = 'block';
    content.innerHTML = '<span class="spinner"></span> Generating summary...';
    btn.disabled = true;

    try {
        // Load actual data for context
        const open = await listRecords('incidents', { filter: 'state:in:new,in_progress', limit: 5, sort: '-priority' });
        const breached = await listRecords('sla_tasks', { filter: 'is_breached:eq:true,state:eq:breached', limit: 5 });

        const incidentContext = (open.data || []).map(i =>
            `- ${i.number}: P${i.priority} "${i.short_description}" (${i.state})`
        ).join('\n') || 'None';

        const slaContext = (breached.data || []).map(s =>
            `- SLA task #${s.id} for incident #${s.incident_id} (breached)`
        ).join('\n') || 'None';

        const result = await callLLM(
            `You are an ITSM shift briefing assistant. Generate a concise shift summary.

Current open incidents (top 5 by priority):
${incidentContext}

Breached SLAs:
${slaContext}

Summarize: what needs attention, any patterns, recommended priorities. Keep it to 3-5 short paragraphs.`,
            { maxTokens: 512 }
        );

        const text = result?.data?.content || result?.data?.text || result?.content || 'Summary unavailable.';
        content.innerHTML = `<div style="white-space: pre-wrap; font-size: var(--text-sm); line-height: 1.7; color: var(--text-1);">${escapeHtml(text)}</div>`;
    } catch (err) {
        console.error('Shift summary failed:', err);
        content.innerHTML = '<p style="color: var(--text-2);">Failed to generate summary.</p>';
    } finally {
        btn.disabled = false;
    }
}
