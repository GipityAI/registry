// pages/agent/approvals.js - Approval center for service requests

import { listRecords, updateRecord } from '../../api.js';
import { timeAgo, stateBadge, escapeHtml, showToast } from '../../utils.js';
import { initTabs } from '../../components/tabs.js';
import { showLoading, showEmpty, showError } from '../../components/data-list.js';

export function renderApprovals() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <div class="page-header">
            <h1>Approvals</h1>
        </div>
        <div class="page-body">
            <div class="tabs" id="approval-tabs">
                <span class="tab active" data-tab="pending">Pending</span>
                <span class="tab" data-tab="completed">Completed</span>
            </div>
            <div id="tab-pending" class="tab-panel">
                <div id="pending-list"><span class="spinner"></span></div>
            </div>
            <div id="tab-completed" class="tab-panel hidden">
                <div id="completed-list"><span class="spinner"></span></div>
            </div>
        </div>
    `;

    initTabs(main, 'tab');
    loadPending();
    loadCompleted();
}

async function loadPending() {
    const container = document.getElementById('pending-list');
    try {
        const result = await listRecords('service_requests', {
            filter: 'approval_state:eq:pending',
            sort: '-created_at',
            limit: 50,
        });
        const items = result.data;

        if (items.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No pending approvals</p></div>';
            return;
        }

        container.innerHTML = items.map(req => `
            <div class="card" style="margin-bottom: var(--sp-3);" data-id="${req.id}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <div style="font-weight: 600; font-size: var(--text-sm);">${escapeHtml(req.number || '#' + req.id)}</div>
                        <div style="font-size: var(--text-xs); color: var(--text-2); margin-top: 2px;">
                            Requested by: ${escapeHtml(req.requested_by_name || req.requested_by)} • ${timeAgo(req.created_at)}
                        </div>
                        ${req.notes ? `<div style="font-size: var(--text-sm); color: var(--text-1); margin-top: var(--sp-2);">${escapeHtml(req.notes)}</div>` : ''}
                    </div>
                    <div style="display: flex; gap: var(--sp-2); flex-shrink: 0;">
                        <button class="btn btn-sm" style="color: var(--success); border-color: var(--success);" data-action="approve" data-id="${req.id}">Approve</button>
                        <button class="btn btn-sm" style="color: var(--danger); border-color: var(--danger);" data-action="reject" data-id="${req.id}">Reject</button>
                    </div>
                </div>
            </div>
        `).join('');

        container.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const action = btn.dataset.action;
                btn.disabled = true;

                try {
                    if (action === 'approve') {
                        await updateRecord('service_requests', id, {
                            approval_state: 'approved',
                            state: 'in_progress',
                        });
                        showToast('Request approved', 'success');
                    } else {
                        const reason = prompt('Rejection reason (optional):') || '';
                        await updateRecord('service_requests', id, {
                            approval_state: 'rejected',
                            state: 'cancelled',
                            notes: reason ? `Rejected: ${reason}` : undefined,
                        });
                        showToast('Request rejected', 'info');
                    }
                    loadPending();
                    loadCompleted();
                } catch (err) {
                    showToast('Failed: ' + err.message, 'error');
                    btn.disabled = false;
                }
            });
        });
    } catch (err) {
        console.error('Failed to load pending approvals:', err);
        container.innerHTML = '<div class="empty-state"><p>Failed to load approvals</p></div>';
    }
}

async function loadCompleted() {
    const container = document.getElementById('completed-list');
    try {
        const result = await listRecords('service_requests', {
            filter: 'approval_state:in:approved,rejected',
            sort: '-updated_at',
            limit: 50,
        });
        const items = result.data;

        if (items.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No completed approvals</p></div>';
            return;
        }

        container.innerHTML = items.map(req => `
            <div style="padding: var(--sp-2) 0; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: var(--sp-3);">
                <span style="color: var(--primary); font-weight: 500; font-size: var(--text-sm); min-width: 80px;">${escapeHtml(req.number || '#' + req.id)}</span>
                <span style="flex: 1; font-size: var(--text-sm); color: var(--text-1);">${escapeHtml(req.requested_by_name || req.requested_by)}</span>
                ${stateBadge(req.approval_state)}
                <span style="color: var(--text-3); font-size: var(--text-xs);">${timeAgo(req.updated_at)}</span>
            </div>
        `).join('');
    } catch (err) {
        console.error('Failed to load completed approvals:', err);
        container.innerHTML = '<div class="empty-state"><p>Failed to load</p></div>';
    }
}
