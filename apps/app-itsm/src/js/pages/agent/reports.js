// pages/agent/reports.js - NL query + aggregate widgets + daily volume chart

import { aggregateRecords, listRecords, callLLM } from '../../api.js';
import { el, escapeHtml, showToast } from '../../utils.js';

export function renderReports() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <div class="page-header">
            <h1>Reports & Analytics</h1>
        </div>
        <div class="page-body">
            <div style="margin-bottom: var(--sp-6);">
                <div class="form-group">
                    <label class="form-label">Ask a Question (Natural Language)</label>
                    <div style="display: flex; gap: var(--sp-2);">
                        <input type="text" class="form-input" id="nl-query" style="flex: 1;"
                               placeholder="e.g., How many P1 incidents were created this week?">
                        <button class="btn btn-primary" id="btn-nl-query">Ask</button>
                    </div>
                </div>
                <div id="nl-result" style="display: none;" class="card"></div>
            </div>

            <div class="dashboard-grid" id="aggregate-widgets">
                <div class="card" id="widget-by-state">
                    <div class="card-title">Open by State</div>
                    <div class="card-body" id="chart-by-state"><span class="spinner"></span></div>
                </div>
                <div class="card" id="widget-by-priority">
                    <div class="card-title">Open by Priority</div>
                    <div class="card-body" id="chart-by-priority"><span class="spinner"></span></div>
                </div>
                <div class="card" id="widget-by-team">
                    <div class="card-title">Open by Team</div>
                    <div class="card-body" id="chart-by-team"><span class="spinner"></span></div>
                </div>
                <div class="card" id="widget-daily-volume">
                    <div class="card-title">Daily Volume (Last 7 Days)</div>
                    <div class="card-body" id="chart-daily-volume"><span class="spinner"></span></div>
                </div>
            </div>
        </div>
    `;

    loadWidgets();

    document.getElementById('btn-nl-query')?.addEventListener('click', handleNlQuery);
    document.getElementById('nl-query')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleNlQuery();
    });
}

async function handleNlQuery() {
    const input = document.getElementById('nl-query');
    const resultContainer = document.getElementById('nl-result');
    const query = input?.value?.trim();
    if (!query) return;

    resultContainer.style.display = 'block';
    resultContainer.innerHTML = '<span class="spinner"></span> Analyzing...';

    try {
        const result = await callLLM(
            `You are an ITSM analytics assistant with access to these tables:
- incidents (state, priority, impact, urgency, team_id, assigned_to, category_id, is_major, created_at, resolved_at, closed_at)
- sla_tasks (state, is_breached, target_type, percentage, incident_id)
- knowledge_articles (state, view_count, helpful_count, category)
- service_requests (state, approval_state, catalog_item_id, created_at)
- kpi_scores (kpi_name, value, dimension, period_date)

The user asks: "${query}"

Provide a concise answer based on what you know about ITSM data patterns. If you would need actual data to answer precisely, explain what query you would run and give a reasonable general answer. Keep it to 2-3 sentences.`,
            { maxTokens: 256 }
        );

        const answer = result?.choices?.[0]?.message?.content || result?.content || 'Unable to process query.';
        resultContainer.innerHTML = `
            <div style="font-size: var(--text-sm); color: var(--text-secondary); line-height: 1.7;">
                ${escapeHtml(answer)}
            </div>
        `;
    } catch (err) {
        console.error('NL query failed:', err);
        resultContainer.innerHTML = '<p style="color: var(--danger); font-size: var(--text-sm);">Failed to process query.</p>';
    }
}

async function loadWidgets() {
    loadByState();
    loadByPriority();
    loadByTeam();
    loadDailyVolume();
}

async function loadByState() {
    const container = document.getElementById('chart-by-state');
    if (!container) return;

    try {
        const result = await aggregateRecords('incidents', {
            group_by: 'state',
            aggregate: 'count',
            filter: 'state:in:new,in_progress,on_hold,resolved',
        });
        const data = result?.rows || result?.data || [];

        if (data.length === 0) {
            container.innerHTML = '<p style="color: var(--text-faint); font-size: var(--text-sm);">No data</p>';
            return;
        }

        container.innerHTML = '';
        const list = el('div', { style: 'margin-top: var(--sp-2);' });
        data.forEach((row) => {
            const label = (row.state || row.group || 'unknown').replace(/_/g, ' ');
            const count = row.count || row.value || 0;
            const item = el('div', {
                style: 'display: flex; justify-content: space-between; padding: var(--sp-1) 0; font-size: var(--text-sm);',
            });
            item.innerHTML = `
                <span style="text-transform: capitalize;">${escapeHtml(label)}</span>
                <span style="font-weight: 700;">${count}</span>
            `;
            list.appendChild(item);
        });
        container.appendChild(list);
    } catch (err) {
        container.innerHTML = '<p style="color: var(--text-faint); font-size: var(--text-sm);">Failed to load</p>';
    }
}

async function loadByPriority() {
    const container = document.getElementById('chart-by-priority');
    if (!container) return;

    try {
        const result = await aggregateRecords('incidents', {
            group_by: 'priority',
            aggregate: 'count',
            filter: 'state:in:new,in_progress,on_hold',
        });
        const data = result?.rows || result?.data || [];

        const priorityLabels = { 1: 'Critical', 2: 'High', 3: 'Moderate', 4: 'Low', 5: 'Planning' };

        container.innerHTML = '';
        const list = el('div', { style: 'margin-top: var(--sp-2);' });
        (data.length ? data : []).forEach((row) => {
            const p = row.priority || row.group;
            const label = priorityLabels[p] || `P${p}`;
            const count = row.count || row.value || 0;
            const item = el('div', {
                style: 'display: flex; justify-content: space-between; padding: var(--sp-1) 0; font-size: var(--text-sm);',
            });
            item.innerHTML = `
                <span class="priority-${p}">${escapeHtml(label)}</span>
                <span style="font-weight: 700;">${count}</span>
            `;
            list.appendChild(item);
        });

        if (data.length === 0) {
            list.innerHTML = '<p style="color: var(--text-faint); font-size: var(--text-sm);">No data</p>';
        }
        container.appendChild(list);
    } catch (err) {
        container.innerHTML = '<p style="color: var(--text-faint); font-size: var(--text-sm);">Failed to load</p>';
    }
}

async function loadByTeam() {
    const container = document.getElementById('chart-by-team');
    if (!container) return;

    try {
        const result = await aggregateRecords('incidents', {
            group_by: 'team_id',
            aggregate: 'count',
            filter: 'state:in:new,in_progress,on_hold',
        });
        const data = result?.rows || result?.data || [];

        container.innerHTML = '';
        const list = el('div', { style: 'margin-top: var(--sp-2);' });
        data.forEach((row) => {
            const label = row.team_name || row.group || `Team ${row.team_id}`;
            const count = row.count || row.value || 0;
            const item = el('div', {
                style: 'display: flex; justify-content: space-between; padding: var(--sp-1) 0; font-size: var(--text-sm);',
            });
            item.innerHTML = `
                <span>${escapeHtml(String(label))}</span>
                <span style="font-weight: 700;">${count}</span>
            `;
            list.appendChild(item);
        });

        if (data.length === 0) {
            list.innerHTML = '<p style="color: var(--text-faint); font-size: var(--text-sm);">No data</p>';
        }
        container.appendChild(list);
    } catch (err) {
        container.innerHTML = '<p style="color: var(--text-faint); font-size: var(--text-sm);">Failed to load</p>';
    }
}

async function loadDailyVolume() {
    const container = document.getElementById('chart-daily-volume');
    if (!container) return;

    try {
        const result = await listRecords('kpi_scores', {
            filter: 'kpi_name:eq:incident_volume',
            sort: '-period_date',
            limit: 7,
        });
        const data = (result?.rows || result?.data || []).reverse();

        if (data.length === 0) {
            container.innerHTML = '<p style="color: var(--text-faint); font-size: var(--text-sm);">No KPI data yet. Run the KPI collection workflow.</p>';
            return;
        }

        const maxVal = Math.max(...data.map((d) => d.value || 0), 1);

        container.innerHTML = '';
        const barGroup = el('div', { className: 'chart-bar-group' });

        data.forEach((row) => {
            const height = Math.max(((row.value || 0) / maxVal) * 140, 4);
            const date = new Date(row.period_date);
            const label = date.toLocaleDateString('en-US', { weekday: 'short' });

            const bar = el('div', {
                className: 'chart-bar',
                style: `height: ${height}px;`,
                title: `${label}: ${row.value}`,
            });
            bar.innerHTML = `<span class="chart-bar-label">${label}</span>`;
            barGroup.appendChild(bar);
        });

        container.appendChild(barGroup);
    } catch (err) {
        container.innerHTML = '<p style="color: var(--text-faint); font-size: var(--text-sm);">Failed to load</p>';
    }
}
