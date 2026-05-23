// pages/agent/incident-new.js - Create incident form with AI-assisted KB deflection

import { createRecord, listRecords } from '../../api.js';
import { el, escapeHtml, showToast } from '../../utils.js';
import { navigate } from '../../router.js';
import { setupKBDeflection } from '../../components/kb-deflection.js';

export function renderIncidentNew() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <div class="page-header">
            <h1>New Incident</h1>
        </div>
        <div class="page-body" style="max-width: 720px;">
            <form id="incident-form">
                <div class="form-group">
                    <label class="form-label">Short Description *</label>
                    <input type="text" class="form-input" id="inc-summary" required
                           placeholder="Brief summary of the issue" maxlength="500">
                    <div id="deflection-container"></div>
                </div>

                <div class="form-group">
                    <label class="form-label">Description</label>
                    <textarea class="form-textarea" id="inc-description" rows="5"
                              placeholder="Detailed description of the issue..."></textarea>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Impact</label>
                        <select class="form-select" id="inc-impact">
                            <option value="3" selected>3 - Low</option>
                            <option value="2">2 - Medium</option>
                            <option value="1">1 - High</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Urgency</label>
                        <select class="form-select" id="inc-urgency">
                            <option value="3" selected>3 - Low</option>
                            <option value="2">2 - Medium</option>
                            <option value="1">1 - High</option>
                        </select>
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Category</label>
                        <select class="form-select" id="inc-category">
                            <option value="">-- Select --</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Subcategory</label>
                        <select class="form-select" id="inc-subcategory" disabled>
                            <option value="">-- Select category first --</option>
                        </select>
                    </div>
                </div>

                <div class="form-group">
                    <label class="form-label">Contact Type</label>
                    <select class="form-select" id="inc-contact-type">
                        <option value="self_service">Self Service</option>
                        <option value="phone">Phone</option>
                        <option value="email">Email</option>
                        <option value="chat">Chat</option>
                        <option value="walk_in">Walk-in</option>
                    </select>
                </div>

                <div class="form-group">
                    <label class="form-label">Attachments</label>
                    <input type="file" id="inc-attachments" multiple class="form-input"
                           style="padding: var(--sp-2);">
                    <span class="form-hint">Optional: attach screenshots or files</span>
                </div>

                <div style="display: flex; gap: var(--sp-3); margin-top: var(--sp-4);">
                    <button type="submit" class="btn btn-primary">Create Incident</button>
                    <a href="/agent/incidents" data-link class="btn">Cancel</a>
                </div>
            </form>
        </div>
    `;

    loadCategories();
    setupDeflection();
    setupCategoryChaining();

    document.getElementById('incident-form')?.addEventListener('submit', handleSubmit);
}

let allCategories = [];

async function loadCategories() {
    try {
        const result = await listRecords('categories', {
            filters: { module: 'incident', is_active: true, parent_id: null },
            sort: { sort_order: 'asc' },
            limit: 100,
        });
        allCategories = result?.rows || result?.data || [];
        const select = document.getElementById('inc-category');
        if (!select) return;

        allCategories.forEach((cat) => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = cat.name;
            select.appendChild(opt);
        });

        // Also load all subcategories
        const subResult = await listRecords('categories', {
            filters: { module: 'incident', is_active: true },
            sort: { sort_order: 'asc' },
            limit: 200,
        });
        allCategories = subResult?.rows || subResult?.data || allCategories;
    } catch (err) {
        console.error('Failed to load categories:', err);
    }
}

function setupCategoryChaining() {
    const catSelect = document.getElementById('inc-category');
    const subSelect = document.getElementById('inc-subcategory');
    if (!catSelect || !subSelect) return;

    catSelect.addEventListener('change', () => {
        const parentId = parseInt(catSelect.value);
        subSelect.innerHTML = '<option value="">-- Select --</option>';
        subSelect.disabled = !parentId;

        if (parentId) {
            const subs = allCategories.filter((c) => c.parent_id === parentId);
            subs.forEach((sub) => {
                const opt = document.createElement('option');
                opt.value = sub.id;
                opt.textContent = sub.name;
                subSelect.appendChild(opt);
            });
        }
    });
}

function setupDeflection() {
    const input = document.getElementById('inc-summary');
    const container = document.getElementById('deflection-container');
    if (!input || !container) return;

    setupKBDeflection(input, container, {
        minLength: 5,
        debounceMs: 400,
        maxResults: 3,
        onArticleClick: () => navigate('/agent/knowledge'),
    });
}

async function handleSubmit(e) {
    e.preventDefault();

    const summary = document.getElementById('inc-summary')?.value?.trim();
    if (!summary) {
        showToast('Summary is required', 'warning');
        return;
    }

    const data = {
        short_description: summary,
        description: document.getElementById('inc-description')?.value?.trim() || null,
        impact: parseInt(document.getElementById('inc-impact')?.value) || 3,
        urgency: parseInt(document.getElementById('inc-urgency')?.value) || 3,
        category_id: parseInt(document.getElementById('inc-category')?.value) || null,
        subcategory_id: parseInt(document.getElementById('inc-subcategory')?.value) || null,
        contact_type: document.getElementById('inc-contact-type')?.value || 'self_service',
        caller_id: 'current_user', // Resolved server-side
        state: 'new',
    };

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';
    }

    try {
        const result = await createRecord('incidents', data);
        showToast('Incident created successfully', 'success');
        navigate('/agent/incidents');
    } catch (err) {
        console.error('Failed to create incident:', err);
        showToast(err.message || 'Failed to create incident', 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Incident';
        }
    }
}
