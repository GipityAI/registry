// pages/portal/report-issue.js - Simplified incident creation with KB deflection

import { createRecord } from '../../api.js';
import { el, escapeHtml, showToast } from '../../utils.js';
import { navigate } from '../../router.js';
import { setupKBDeflection } from '../../components/kb-deflection.js';

export function renderReportIssue() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <div class="portal-layout">
            <div style="margin-bottom: var(--sp-4);">
                <a href="/" data-link style="font-size: var(--text-sm); color: var(--text-muted);">&larr; Back to Portal</a>
            </div>
            <h1 style="margin-bottom: var(--sp-6);">Report an Issue</h1>

            <form id="report-form" style="max-width: 600px;">
                <div class="form-group">
                    <label class="form-label">What's the problem? *</label>
                    <input type="text" class="form-input" id="report-summary" required
                           placeholder="Brief summary, e.g., 'Cannot connect to VPN'" maxlength="500"
                           style="font-size: var(--text-md);">
                    <div id="report-deflection"></div>
                </div>

                <div class="form-group">
                    <label class="form-label">More Details</label>
                    <textarea class="form-textarea" id="report-description" rows="5"
                              placeholder="Steps to reproduce, error messages, when it started..."></textarea>
                </div>

                <div class="form-group">
                    <label class="form-label">How urgent is this?</label>
                    <select class="form-select" id="report-urgency">
                        <option value="3" selected>Normal - I can work around it</option>
                        <option value="2">High - Significantly impacting my work</option>
                        <option value="1">Critical - I cannot work at all</option>
                    </select>
                </div>

                <div class="form-group">
                    <label class="form-label">Attachments</label>
                    <input type="file" id="report-attachments" multiple class="form-input"
                           style="padding: var(--sp-2);">
                    <span class="form-hint">Screenshots or files that help describe the issue</span>
                </div>

                <div style="display: flex; gap: var(--sp-3); margin-top: var(--sp-4);">
                    <button type="submit" class="btn btn-primary" style="font-size: var(--text-base); padding: var(--sp-3) var(--sp-6);">
                        Submit
                    </button>
                    <a href="/" data-link class="btn" style="font-size: var(--text-base); padding: var(--sp-3) var(--sp-6);">
                        Cancel
                    </a>
                </div>
            </form>
        </div>
    `;

    setupDeflection();
    document.getElementById('report-form')?.addEventListener('submit', handleSubmit);
}

function setupDeflection() {
    const input = document.getElementById('report-summary');
    const container = document.getElementById('report-deflection');
    if (!input || !container) return;

    setupKBDeflection(input, container, {
        minLength: 5,
        debounceMs: 400,
        maxResults: 3,
        onArticleClick: (article) => {
            showToast(`Opening: ${article.title}`, 'info');
            // TODO: open article in modal or navigate to KB
        },
    });
}

async function handleSubmit(e) {
    e.preventDefault();

    const summary = document.getElementById('report-summary')?.value?.trim();
    if (!summary) {
        showToast('Please describe the problem', 'warning');
        return;
    }

    const urgency = parseInt(document.getElementById('report-urgency')?.value) || 3;

    const data = {
        short_description: summary,
        description: document.getElementById('report-description')?.value?.trim() || null,
        urgency,
        impact: 3, // End users default to low impact; agent can escalate
        contact_type: 'self_service',
        caller_id: 'current_user',
        state: 'new',
    };

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
    }

    try {
        const result = await createRecord('incidents', data);
        const number = result?.row?.number || result?.data?.number || '';
        showToast(`Issue reported${number ? `: ${number}` : ''}. We'll get on it!`, 'success', 6000);
        navigate('/portal/requests');
    } catch (err) {
        console.error('Failed to report issue:', err);
        showToast(err.message || 'Failed to submit. Please try again.', 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit';
        }
    }
}
