// pages/agent/settings.js - Tabbed settings: General, Categories, Teams, AI Features

import { getSettings, updateSetting, listRecords } from '../../api.js';
import { el, escapeHtml, showToast } from '../../utils.js';

let currentTab = 'general';
let settings = {};

export function renderSettings() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <div class="page-header">
            <h1>Settings</h1>
        </div>
        <div style="display: flex; flex-direction: column;">
            <div class="tabs" id="settings-tabs">
                <button class="tab active" data-tab="general">General</button>
                <button class="tab" data-tab="categories">Categories</button>
                <button class="tab" data-tab="teams">Teams</button>
                <button class="tab" data-tab="ai">AI Features</button>
            </div>
            <div class="page-body" id="settings-body">
                <div class="skeleton skeleton-box"></div>
            </div>
        </div>
    `;

    // Tab switching
    document.querySelectorAll('#settings-tabs .tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            currentTab = tab.dataset.tab;
            document.querySelectorAll('#settings-tabs .tab').forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');
            renderTabContent();
        });
    });

    loadSettings();
}

async function loadSettings() {
    try {
        const result = await getSettings();
        const rows = result?.rows || result?.data || [];
        settings = {};
        rows.forEach((row) => {
            settings[row.key] = row.value;
        });
    } catch (err) {
        console.error('Failed to load settings:', err);
        settings = {};
    }
    renderTabContent();
}

function renderTabContent() {
    const body = document.getElementById('settings-body');
    if (!body) return;

    switch (currentTab) {
        case 'general': renderGeneralTab(body); break;
        case 'categories': renderCategoriesTab(body); break;
        case 'teams': renderTeamsTab(body); break;
        case 'ai': renderAiTab(body); break;
    }
}

function getSetting(key, fallback) {
    const val = settings[key];
    if (val === undefined || val === null) return fallback;
    // JSONB values may be raw or stringified
    if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return val; }
    }
    return val;
}

function renderGeneralTab(body) {
    const autoCloseDays = getSetting('auto_close_days', 7);
    const defaultContact = getSetting('default_contact_type', 'self_service');
    const incPrefix = getSetting('incident_number_prefix', 'INC');
    const kbPrefix = getSetting('kb_number_prefix', 'KB');
    const reqPrefix = getSetting('request_number_prefix', 'REQ');

    body.innerHTML = `
        <div style="max-width: 500px;">
            <div class="form-group">
                <label class="form-label">Auto-Close Resolved Incidents (days)</label>
                <input type="number" class="form-input" id="set-auto-close" value="${autoCloseDays}" min="1" max="90">
                <span class="form-hint">Resolved incidents will be auto-closed after this many days.</span>
            </div>
            <div class="form-group">
                <label class="form-label">Default Contact Type</label>
                <select class="form-select" id="set-contact-type">
                    ${['self_service', 'phone', 'email', 'chat', 'walk_in'].map(
                        (v) => `<option value="${v}" ${v === defaultContact ? 'selected' : ''}>${v.replace(/_/g, ' ')}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Incident Prefix</label>
                    <input type="text" class="form-input" id="set-inc-prefix" value="${escapeHtml(String(incPrefix))}" maxlength="10">
                </div>
                <div class="form-group">
                    <label class="form-label">KB Prefix</label>
                    <input type="text" class="form-input" id="set-kb-prefix" value="${escapeHtml(String(kbPrefix))}" maxlength="10">
                </div>
                <div class="form-group">
                    <label class="form-label">Request Prefix</label>
                    <input type="text" class="form-input" id="set-req-prefix" value="${escapeHtml(String(reqPrefix))}" maxlength="10">
                </div>
            </div>
            <button class="btn btn-primary" id="btn-save-general">Save</button>
        </div>
    `;

    document.getElementById('btn-save-general')?.addEventListener('click', async () => {
        try {
            await updateSetting('auto_close_days', parseInt(document.getElementById('set-auto-close')?.value) || 7);
            await updateSetting('default_contact_type', document.getElementById('set-contact-type')?.value);
            await updateSetting('incident_number_prefix', document.getElementById('set-inc-prefix')?.value);
            await updateSetting('kb_number_prefix', document.getElementById('set-kb-prefix')?.value);
            await updateSetting('request_number_prefix', document.getElementById('set-req-prefix')?.value);
            showToast('Settings saved', 'success');
        } catch (err) {
            showToast('Failed to save settings', 'error');
        }
    });
}

async function renderCategoriesTab(body) {
    body.innerHTML = '<span class="spinner"></span> Loading categories...';

    try {
        const result = await listRecords('categories', {
            filters: { module: 'incident' },
            sort: { sort_order: 'asc' },
            limit: 200,
        });
        const categories = result?.rows || result?.data || [];

        // Build tree
        const topLevel = categories.filter((c) => !c.parent_id);
        const children = (parentId) => categories.filter((c) => c.parent_id === parentId);

        let html = '<div style="max-width: 500px;">';
        topLevel.forEach((cat) => {
            html += `
                <div style="margin-bottom: var(--sp-3);">
                    <div style="font-weight: 700; font-size: var(--text-sm); color: var(--text-primary); padding: var(--sp-2) 0;">
                        ${escapeHtml(cat.name)}
                        ${!cat.is_active ? '<span style="color: var(--text-faint); font-size: var(--text-xs);">(inactive)</span>' : ''}
                    </div>
            `;
            const subs = children(cat.id);
            if (subs.length > 0) {
                html += '<div style="padding-left: var(--sp-6); border-left: 2px solid var(--border);">';
                subs.forEach((sub) => {
                    html += `<div style="font-size: var(--text-sm); color: var(--text-secondary); padding: var(--sp-1) 0;">
                        ${escapeHtml(sub.name)}
                        ${!sub.is_active ? '<span style="color: var(--text-faint); font-size: var(--text-xs);">(inactive)</span>' : ''}
                    </div>`;
                });
                html += '</div>';
            }
            html += '</div>';
        });
        html += '</div>';

        body.innerHTML = html;
    } catch (err) {
        body.innerHTML = '<p style="color: var(--danger);">Failed to load categories</p>';
    }
}

async function renderTeamsTab(body) {
    body.innerHTML = '<span class="spinner"></span> Loading teams...';

    try {
        const result = await listRecords('teams', {
            sort: { name: 'asc' },
            limit: 50,
        });
        const teams = result?.rows || result?.data || [];

        if (teams.length === 0) {
            body.innerHTML = '<div class="empty-state"><p>No teams configured</p></div>';
            return;
        }

        let html = '<table class="data-table" style="max-width: 600px;"><thead><tr><th>Name</th><th>Slug</th><th>Email</th><th>Status</th></tr></thead><tbody>';
        teams.forEach((team) => {
            html += `
                <tr>
                    <td>${escapeHtml(team.name)}</td>
                    <td style="color: var(--text-muted);">${escapeHtml(team.slug)}</td>
                    <td style="color: var(--text-muted);">${escapeHtml(team.email || '--')}</td>
                    <td>${team.is_active ? '<span style="color: var(--success);">Active</span>' : '<span style="color: var(--text-faint);">Inactive</span>'}</td>
                </tr>
            `;
        });
        html += '</tbody></table>';
        body.innerHTML = html;
    } catch (err) {
        body.innerHTML = '<p style="color: var(--danger);">Failed to load teams</p>';
    }
}

function renderAiTab(body) {
    const aiCategorize = getSetting('ai_auto_categorize_enabled', true);
    const aiConfidence = getSetting('ai_confidence_threshold', 0.7);
    const aiAssign = getSetting('ai_auto_assign_enabled', true);
    const aiAssignConf = getSetting('ai_auto_assign_confidence', 0.85);
    const aiKb = getSetting('ai_kb_generation_enabled', true);
    const aiSentiment = getSetting('ai_sentiment_enabled', true);

    body.innerHTML = `
        <div style="max-width: 500px;">
            <h3 style="font-size: var(--text-base); margin-bottom: var(--sp-4);">AI-Powered Features</h3>

            <div class="form-group">
                <label style="display: flex; align-items: center; gap: var(--sp-2); cursor: pointer;">
                    <input type="checkbox" id="ai-categorize" ${aiCategorize ? 'checked' : ''}>
                    <span class="form-label" style="margin: 0;">Auto-Categorize Incidents</span>
                </label>
                <span class="form-hint">AI automatically assigns category and subcategory to new incidents.</span>
            </div>

            <div class="form-group">
                <label class="form-label">Classification Confidence Threshold</label>
                <div style="display: flex; align-items: center; gap: var(--sp-3);">
                    <input type="range" id="ai-confidence" min="0.5" max="1.0" step="0.05"
                           value="${aiConfidence}" style="flex: 1;">
                    <span id="ai-confidence-val" style="font-size: var(--text-sm); min-width: 40px;">${Math.round(aiConfidence * 100)}%</span>
                </div>
                <span class="form-hint">AI suggestions below this confidence will not be auto-applied.</span>
            </div>

            <div class="form-group">
                <label style="display: flex; align-items: center; gap: var(--sp-2); cursor: pointer;">
                    <input type="checkbox" id="ai-assign" ${aiAssign ? 'checked' : ''}>
                    <span class="form-label" style="margin: 0;">Auto-Assign to Best Agent</span>
                </label>
                <span class="form-hint">AI assigns incidents based on workload and expertise.</span>
            </div>

            <div class="form-group">
                <label class="form-label">Assignment Confidence Threshold</label>
                <div style="display: flex; align-items: center; gap: var(--sp-3);">
                    <input type="range" id="ai-assign-conf" min="0.5" max="1.0" step="0.05"
                           value="${aiAssignConf}" style="flex: 1;">
                    <span id="ai-assign-conf-val" style="font-size: var(--text-sm); min-width: 40px;">${Math.round(aiAssignConf * 100)}%</span>
                </div>
            </div>

            <div class="form-group">
                <label style="display: flex; align-items: center; gap: var(--sp-2); cursor: pointer;">
                    <input type="checkbox" id="ai-kb" ${aiKb ? 'checked' : ''}>
                    <span class="form-label" style="margin: 0;">Auto-Generate KB Articles</span>
                </label>
                <span class="form-hint">Generate draft KB articles from resolved incidents.</span>
            </div>

            <div class="form-group">
                <label style="display: flex; align-items: center; gap: var(--sp-2); cursor: pointer;">
                    <input type="checkbox" id="ai-sentiment" ${aiSentiment ? 'checked' : ''}>
                    <span class="form-label" style="margin: 0;">Sentiment Analysis on Comments</span>
                </label>
                <span class="form-hint">Detect negative sentiment and escalate automatically.</span>
            </div>

            <button class="btn btn-primary" id="btn-save-ai">Save AI Settings</button>
        </div>
    `;

    // Live confidence display
    document.getElementById('ai-confidence')?.addEventListener('input', (e) => {
        document.getElementById('ai-confidence-val').textContent = `${Math.round(e.target.value * 100)}%`;
    });
    document.getElementById('ai-assign-conf')?.addEventListener('input', (e) => {
        document.getElementById('ai-assign-conf-val').textContent = `${Math.round(e.target.value * 100)}%`;
    });

    document.getElementById('btn-save-ai')?.addEventListener('click', async () => {
        try {
            await updateSetting('ai_auto_categorize_enabled', document.getElementById('ai-categorize')?.checked);
            await updateSetting('ai_confidence_threshold', parseFloat(document.getElementById('ai-confidence')?.value));
            await updateSetting('ai_auto_assign_enabled', document.getElementById('ai-assign')?.checked);
            await updateSetting('ai_auto_assign_confidence', parseFloat(document.getElementById('ai-assign-conf')?.value));
            await updateSetting('ai_kb_generation_enabled', document.getElementById('ai-kb')?.checked);
            await updateSetting('ai_sentiment_enabled', document.getElementById('ai-sentiment')?.checked);
            showToast('AI settings saved', 'success');
        } catch (err) {
            showToast('Failed to save AI settings', 'error');
        }
    });
}
