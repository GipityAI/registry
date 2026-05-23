// pages/agent/incident-mim.js - Major Incident Manager view
// Commander assignment, bridge link, stakeholder updates, timeline

import { getRecord, updateRecord, createRecord, listRecords } from '../../api.js';
import { timeAgo, escapeHtml, showToast, stateBadge } from '../../utils.js';
import { navigate } from '../../router.js';

export function renderMajorIncident(params) {
    const incidentId = params?.id;
    if (!incidentId) {
        navigate('/agent/incidents');
        return;
    }

    const main = document.getElementById('main-content');
    main.innerHTML = `
        <div class="page-header">
            <div>
                <a href="/agent/incidents/${incidentId}" data-link style="font-size: var(--text-xs); color: var(--text-2);">&larr; Back to Incident</a>
                <h1 style="font-size: var(--text-lg);">Major Incident Manager</h1>
            </div>
            <div class="page-actions" id="mim-actions"></div>
        </div>
        <div class="page-body">
            <div id="mim-header"><span class="spinner"></span></div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-4); margin-top: var(--sp-4);">
                <div class="card" id="mim-details">
                    <div class="card-title">Incident Details</div>
                    <div id="mim-details-body"><span class="spinner"></span></div>
                </div>
                <div class="card" id="mim-config">
                    <div class="card-title">MIM Configuration</div>
                    <div id="mim-config-body"><span class="spinner"></span></div>
                </div>
            </div>

            <div class="card" style="margin-top: var(--sp-4);">
                <div class="card-header">
                    <span class="card-title">Stakeholder Updates</span>
                    <button class="btn btn-sm btn-primary" id="btn-add-update">+ Post Update</button>
                </div>
                <div id="mim-updates"><span class="spinner"></span></div>
            </div>
        </div>
    `;

    loadMimData(incidentId);
}

async function loadMimData(incidentId) {
    try {
        // Load incident
        const incResult = await getRecord('incidents', incidentId);
        const inc = incResult.data;

        if (!inc) {
            document.getElementById('mim-header').innerHTML = '<div class="empty-state"><p>Incident not found</p></div>';
            return;
        }

        // Header
        document.getElementById('mim-header').innerHTML = `
            <div style="display: flex; align-items: center; gap: var(--sp-3);">
                <span style="font-weight: 600; color: var(--primary); font-size: var(--text-lg);">${escapeHtml(inc.number || '#' + inc.id)}</span>
                ${stateBadge(inc.state)}
                <span class="priority-${inc.priority}" style="font-weight: 600;">P${inc.priority}</span>
                ${inc.is_major ? '<span class="state-badge" style="background: var(--danger-bg); color: var(--danger);">MAJOR</span>' : ''}
            </div>
            <h2 style="margin-top: var(--sp-2); font-size: var(--text-base);">${escapeHtml(inc.short_description)}</h2>
        `;

        // If not declared major yet, show a button to declare
        if (!inc.is_major) {
            document.getElementById('mim-actions').innerHTML = `
                <button class="btn btn-danger btn-sm" id="btn-declare-major">Declare Major Incident</button>
            `;
            document.getElementById('btn-declare-major')?.addEventListener('click', async () => {
                try {
                    await updateRecord('incidents', incidentId, { is_major: true, severity: 1 });
                    await createRecord('major_incidents', {
                        incident_id: incidentId,
                        update_frequency_minutes: 30,
                    });
                    showToast('Declared as Major Incident', 'success');
                    loadMimData(incidentId);
                } catch (err) {
                    showToast('Failed: ' + err.message, 'error');
                }
            });
        }

        // Details
        document.getElementById('mim-details-body').innerHTML = `
            <div class="field-grid" style="margin-top: var(--sp-2);">
                <div class="field-item"><div class="field-label">State</div><div class="field-value">${stateBadge(inc.state)}</div></div>
                <div class="field-item"><div class="field-label">Priority</div><div class="field-value">P${inc.priority}</div></div>
                <div class="field-item"><div class="field-label">Assigned To</div><div class="field-value">${escapeHtml(inc.assigned_to || 'Unassigned')}</div></div>
                <div class="field-item"><div class="field-label">Caller</div><div class="field-value">${escapeHtml(inc.caller_name || inc.caller_id || '-')}</div></div>
                <div class="field-item"><div class="field-label">Created</div><div class="field-value">${timeAgo(inc.created_at)}</div></div>
                <div class="field-item"><div class="field-label">Severity</div><div class="field-value">${inc.severity ? 'Sev' + inc.severity : '-'}</div></div>
            </div>
            ${inc.description ? `<div style="margin-top: var(--sp-3); font-size: var(--text-sm); color: var(--text-1);">${escapeHtml(inc.description)}</div>` : ''}
        `;

        // Load MIM record if major
        if (inc.is_major) {
            await loadMimConfig(incidentId);
            await loadMimUpdates(incidentId);
        } else {
            document.getElementById('mim-config-body').innerHTML = '<p style="color: var(--text-2); font-size: var(--text-sm);">Declare as major incident to configure MIM.</p>';
            document.getElementById('mim-updates').innerHTML = '<p style="color: var(--text-2); font-size: var(--text-sm);">No updates yet.</p>';
        }

        // Post update button
        document.getElementById('btn-add-update')?.addEventListener('click', () => showUpdateForm(incidentId));

    } catch (err) {
        console.error('Failed to load MIM data:', err);
        document.getElementById('mim-header').innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
    }
}

async function loadMimConfig(incidentId) {
    const container = document.getElementById('mim-config-body');
    try {
        const result = await listRecords('major_incidents', {
            filter: `incident_id:eq:${incidentId}`,
            limit: 1,
        });
        const mim = result.data[0];

        if (!mim) {
            container.innerHTML = '<p style="color: var(--text-2); font-size: var(--text-sm);">MIM record not found.</p>';
            return;
        }

        container.innerHTML = `
            <form id="mim-config-form" style="margin-top: var(--sp-2);">
                <div class="form-group">
                    <label class="form-label">Incident Commander</label>
                    <input type="text" class="form-input" id="mim-commander" value="${escapeHtml(mim.commander_user_id || '')}" placeholder="User ID">
                </div>
                <div class="form-group">
                    <label class="form-label">Bridge URL</label>
                    <input type="url" class="form-input" id="mim-bridge" value="${escapeHtml(mim.bridge_url || '')}" placeholder="https://meet.google.com/...">
                </div>
                <div class="form-group">
                    <label class="form-label">Slack Channel</label>
                    <input type="text" class="form-input" id="mim-slack" value="${escapeHtml(mim.slack_channel || '')}" placeholder="#incident-123">
                </div>
                <div class="form-group">
                    <label class="form-label">Business Impact</label>
                    <textarea class="form-textarea" id="mim-impact" rows="3" placeholder="Describe the business impact...">${escapeHtml(mim.business_impact || '')}</textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Update Frequency (minutes)</label>
                    <input type="number" class="form-input" id="mim-freq" value="${mim.update_frequency_minutes || 30}" min="5" max="120" style="width: 100px;">
                </div>
                <button type="submit" class="btn btn-sm btn-primary">Save Configuration</button>
            </form>
        `;

        document.getElementById('mim-config-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                await updateRecord('major_incidents', mim.id, {
                    commander_user_id: document.getElementById('mim-commander').value || null,
                    bridge_url: document.getElementById('mim-bridge').value || null,
                    slack_channel: document.getElementById('mim-slack').value || null,
                    business_impact: document.getElementById('mim-impact').value || null,
                    update_frequency_minutes: parseInt(document.getElementById('mim-freq').value) || 30,
                });
                showToast('MIM configuration saved', 'success');
            } catch (err) {
                showToast('Failed: ' + err.message, 'error');
            }
        });
    } catch (err) {
        console.error('Failed to load MIM config:', err);
        container.innerHTML = '<p style="color: var(--text-2);">Failed to load configuration.</p>';
    }
}

async function loadMimUpdates(incidentId) {
    const container = document.getElementById('mim-updates');
    try {
        // Get MIM record ID first
        const mimResult = await listRecords('major_incidents', {
            filter: `incident_id:eq:${incidentId}`,
            limit: 1,
        });
        const mim = mimResult.data[0];
        if (!mim) {
            container.innerHTML = '<p style="color: var(--text-2); font-size: var(--text-sm);">No MIM record.</p>';
            return;
        }

        const result = await listRecords('major_incident_updates', {
            filter: `major_incident_id:eq:${mim.id}`,
            sort: '-created_at',
            limit: 50,
        });
        const updates = result.data;

        if (updates.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding: var(--sp-4);"><p>No stakeholder updates yet. Post the first one.</p></div>';
            return;
        }

        container.innerHTML = updates.map(u => {
            const typeColors = {
                status_update: 'var(--info)',
                resolution: 'var(--success)',
                post_mortem: 'var(--warning)',
            };
            const color = typeColors[u.update_type] || 'var(--text-2)';
            return `
                <div class="activity-item">
                    <div class="activity-header">
                        <span style="color: ${color}; font-weight: 600; font-size: var(--text-xs); text-transform: uppercase;">${(u.update_type || '').replace(/_/g, ' ')}</span>
                        <span class="activity-type" style="background: var(--bg-3);">${escapeHtml(u.audience)}</span>
                        <span class="activity-time">${timeAgo(u.created_at)}</span>
                    </div>
                    <div class="activity-body" style="margin-top: var(--sp-1);">${escapeHtml(u.message)}</div>
                    <div style="font-size: var(--text-xs); color: var(--text-3); margin-top: var(--sp-1);">By: ${escapeHtml(u.created_by || 'unknown')}</div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Failed to load MIM updates:', err);
        container.innerHTML = '<p style="color: var(--text-2);">Failed to load updates.</p>';
    }
}

function showUpdateForm(incidentId) {
    const container = document.getElementById('mim-updates');
    const existingContent = container.innerHTML;

    const formHtml = `
        <div class="card" style="margin-bottom: var(--sp-3); border-color: var(--primary);">
            <form id="update-form">
                <div class="form-group">
                    <label class="form-label">Update Type</label>
                    <select class="form-select" id="update-type">
                        <option value="status_update">Status Update</option>
                        <option value="resolution">Resolution</option>
                        <option value="post_mortem">Post-Mortem</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Message</label>
                    <textarea class="form-textarea" id="update-message" rows="4" required placeholder="What's the current status?"></textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Audience</label>
                    <select class="form-select" id="update-audience">
                        <option value="internal">Internal (IT Only)</option>
                        <option value="stakeholders">Stakeholders</option>
                        <option value="all">All (Public)</option>
                    </select>
                </div>
                <div style="display: flex; gap: var(--sp-2);">
                    <button type="submit" class="btn btn-primary btn-sm">Post Update</button>
                    <button type="button" class="btn btn-sm" id="btn-cancel-update">Cancel</button>
                </div>
            </form>
        </div>
    `;

    container.innerHTML = formHtml + existingContent;

    document.getElementById('btn-cancel-update')?.addEventListener('click', () => {
        container.innerHTML = existingContent;
    });

    document.getElementById('update-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Posting...';

        try {
            // Get MIM record
            const mimResult = await listRecords('major_incidents', {
                filter: `incident_id:eq:${incidentId}`,
                limit: 1,
            });
            const mim = mimResult.data[0];
            if (!mim) throw new Error('MIM record not found');

            await createRecord('major_incident_updates', {
                major_incident_id: mim.id,
                update_type: document.getElementById('update-type').value,
                message: document.getElementById('update-message').value,
                audience: document.getElementById('update-audience').value,
                created_by: 'current',
            });

            showToast('Update posted', 'success');
            loadMimUpdates(incidentId);
        } catch (err) {
            showToast('Failed: ' + err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Post Update';
        }
    });
}
