// pages/portal/catalog.js - Service catalog with category filtering and order modal

import { listRecords, createRecord } from '../../api.js';
import { el, escapeHtml, showToast } from '../../utils.js';
import { navigate } from '../../router.js';

let catalogItems = [];
let catalogCategories = [];
let selectedCategoryId = null;

export function renderCatalog() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <div class="portal-layout">
            <div style="margin-bottom: var(--sp-4);">
                <a href="/" data-link style="font-size: var(--text-sm); color: var(--text-muted);">&larr; Back to Portal</a>
            </div>
            <h1 style="margin-bottom: var(--sp-2);">Service Catalog</h1>
            <p style="color: var(--text-muted); margin-bottom: var(--sp-6); font-size: var(--text-sm);">
                Browse and request IT services, hardware, and software.
            </p>

            <div class="filter-bar" id="catalog-filters" style="margin-bottom: var(--sp-6);">
                <span class="spinner"></span>
            </div>

            <div class="catalog-grid" id="catalog-grid">
                <div class="skeleton skeleton-box"></div>
                <div class="skeleton skeleton-box"></div>
                <div class="skeleton skeleton-box"></div>
            </div>
        </div>

        <!-- Order Modal -->
        <div id="order-modal-overlay" class="modal-overlay" style="display: none;">
            <div class="modal" style="width: 540px;">
                <div class="modal-header">
                    <h2 id="order-modal-title">Order Item</h2>
                    <button class="modal-close" id="order-modal-close">&times;</button>
                </div>
                <div class="modal-body" id="order-modal-body"></div>
                <div class="modal-footer">
                    <button class="btn" id="order-cancel">Cancel</button>
                    <button class="btn btn-primary" id="order-submit">Submit Request</button>
                </div>
            </div>
        </div>
    `;

    loadCatalog();
}

async function loadCatalog() {
    try {
        const catResult = await listRecords('catalog_categories', {
            filters: { is_active: true },
            sort: { sort_order: 'asc' },
        });
        catalogCategories = catResult?.rows || catResult?.data || [];

        const itemResult = await listRecords('catalog_items', {
            filters: { is_active: true },
            sort: { name: 'asc' },
            limit: 100,
        });
        catalogItems = itemResult?.rows || itemResult?.data || [];

        renderFilters();
        renderItems();
    } catch (err) {
        console.error('Failed to load catalog:', err);
        document.getElementById('catalog-grid').innerHTML =
            '<div class="empty-state"><p>Failed to load catalog. Please try again.</p></div>';
    }
}

function renderFilters() {
    const container = document.getElementById('catalog-filters');
    if (!container) return;

    container.innerHTML = '';

    const allChip = el('button', {
        className: `filter-chip ${selectedCategoryId === null ? 'active' : ''}`,
        onClick: () => {
            selectedCategoryId = null;
            renderFilters();
            renderItems();
        },
    }, 'All');
    container.appendChild(allChip);

    catalogCategories.forEach((cat) => {
        const chip = el('button', {
            className: `filter-chip ${selectedCategoryId === cat.id ? 'active' : ''}`,
            onClick: () => {
                selectedCategoryId = cat.id;
                renderFilters();
                renderItems();
            },
        }, cat.name);
        container.appendChild(chip);
    });
}

function renderItems() {
    const container = document.getElementById('catalog-grid');
    if (!container) return;

    const filtered = selectedCategoryId
        ? catalogItems.filter((item) => item.category_id === selectedCategoryId)
        : catalogItems;

    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No items in this category</p></div>';
        return;
    }

    container.innerHTML = '';
    filtered.forEach((item) => {
        const category = catalogCategories.find((c) => c.id === item.category_id);
        const card = el('div', {
            className: 'catalog-card',
            onClick: () => openOrderModal(item),
        });
        card.innerHTML = `
            <h3>${escapeHtml(item.name)}</h3>
            <p>${escapeHtml(item.description || '')}</p>
            <div class="catalog-card-meta">
                <span>${escapeHtml(category?.name || '')}</span>
                <span>${item.delivery_days === 0 ? 'Instant' : `${item.delivery_days} day${item.delivery_days > 1 ? 's' : ''}`}</span>
            </div>
            <div style="margin-top: var(--sp-2); display: flex; justify-content: space-between; align-items: center;">
                ${item.price > 0 ? `<span style="font-weight: 700;">$${item.price}</span>` : '<span style="color: var(--success);">Free</span>'}
                ${item.approval_required ? '<span style="font-size: var(--text-xs); color: var(--warning);">Approval Required</span>' : ''}
            </div>
        `;
        container.appendChild(card);
    });
}

function openOrderModal(item) {
    const overlay = document.getElementById('order-modal-overlay');
    const title = document.getElementById('order-modal-title');
    const body = document.getElementById('order-modal-body');

    title.textContent = item.name;
    overlay.style.display = 'flex';

    // Build form fields from form_schema
    let fieldsHtml = '';
    const schema = item.form_schema;
    const fields = schema?.fields || [];

    fields.forEach((field) => {
        fieldsHtml += `<div class="form-group">`;
        fieldsHtml += `<label class="form-label">${escapeHtml(field.label)}${field.required ? ' *' : ''}</label>`;

        if (field.type === 'select') {
            fieldsHtml += `<select class="form-select" data-field="${escapeHtml(field.name)}" ${field.required ? 'required' : ''}>`;
            fieldsHtml += `<option value="">-- Select --</option>`;
            (field.options || []).forEach((opt) => {
                fieldsHtml += `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`;
            });
            fieldsHtml += `</select>`;
        } else if (field.type === 'textarea') {
            fieldsHtml += `<textarea class="form-textarea" data-field="${escapeHtml(field.name)}" ${field.required ? 'required' : ''} rows="3"></textarea>`;
        } else if (field.type === 'date') {
            fieldsHtml += `<input type="date" class="form-input" data-field="${escapeHtml(field.name)}" ${field.required ? 'required' : ''}>`;
        } else {
            fieldsHtml += `<input type="text" class="form-input" data-field="${escapeHtml(field.name)}" ${field.required ? 'required' : ''}>`;
        }

        fieldsHtml += `</div>`;
    });

    if (fields.length === 0) {
        fieldsHtml = `<p style="color: var(--text-muted); font-size: var(--text-sm);">No additional information required.</p>`;
    }

    fieldsHtml += `
        <div class="form-group">
            <label class="form-label">Quantity</label>
            <input type="number" class="form-input" id="order-quantity" value="1" min="1" max="99" style="width: 80px;">
        </div>
        <div class="form-group">
            <label class="form-label">Additional Notes</label>
            <textarea class="form-textarea" id="order-notes" rows="2" placeholder="Anything else we should know..."></textarea>
        </div>
    `;

    if (item.approval_required) {
        fieldsHtml += `<p style="font-size: var(--text-xs); color: var(--warning); margin-top: var(--sp-2);">This item requires manager approval before fulfillment.</p>`;
    }

    body.innerHTML = fieldsHtml;

    // Close handlers
    const close = () => { overlay.style.display = 'none'; };
    document.getElementById('order-modal-close').onclick = close;
    document.getElementById('order-cancel').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Submit handler
    document.getElementById('order-submit').onclick = () => submitOrder(item, close);
}

async function submitOrder(item, closeModal) {
    const btn = document.getElementById('order-submit');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    // Gather form data
    const formData = {};
    document.querySelectorAll('#order-modal-body [data-field]').forEach((input) => {
        const name = input.dataset.field;
        const value = input.value?.trim();
        if (value) formData[name] = value;
    });

    const quantity = parseInt(document.getElementById('order-quantity')?.value) || 1;
    const notes = document.getElementById('order-notes')?.value?.trim() || null;

    try {
        await createRecord('service_requests', {
            catalog_item_id: item.id,
            requested_by: 'current_user',
            state: 'pending',
            approval_state: item.approval_required ? 'pending' : 'not_required',
            team_id: item.fulfillment_team_id,
            form_data: formData,
            quantity,
            notes,
        });

        closeModal();
        showToast(`Request submitted for ${item.name}`, 'success', 5000);
        navigate('/my-requests');
    } catch (err) {
        console.error('Failed to submit order:', err);
        showToast(err.message || 'Failed to submit request', 'error');
        btn.disabled = false;
        btn.textContent = 'Submit Request';
    }
}
