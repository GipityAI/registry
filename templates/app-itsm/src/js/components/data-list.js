// components/data-list.js - Reusable list rendering with loading/empty/error states

import { escapeHtml } from '../utils.js';

/**
 * Show a loading spinner in a container.
 */
export function showLoading(container) {
    container.innerHTML = '<div style="padding: var(--sp-6); text-align: center;"><span class="spinner"></span></div>';
}

/**
 * Show an empty state message with optional CTA.
 * @param {HTMLElement} container
 * @param {string} message
 * @param {string} [ctaHtml] - Optional HTML for a call-to-action button
 */
export function showEmpty(container, message, ctaHtml = '') {
    container.innerHTML = `<div class="empty-state">
        <p>${escapeHtml(message)}</p>
        ${ctaHtml}
    </div>`;
}

/**
 * Show an error state.
 */
export function showError(container, message) {
    container.innerHTML = `<div class="empty-state"><p style="color: var(--danger);">${escapeHtml(message)}</p></div>`;
}

/**
 * Render a list of items using a row renderer function.
 *
 * @param {HTMLElement} container - Where to render
 * @param {Array} items - Data array
 * @param {function} renderRow - (item, index) => HTML string
 * @param {object} options - { emptyMessage, ctaHtml, onRowClick }
 */
export function renderDataList(container, items, renderRow, options = {}) {
    const { emptyMessage = 'No items found', ctaHtml = '', onRowClick = null } = options;

    if (!items || items.length === 0) {
        showEmpty(container, emptyMessage, ctaHtml);
        return;
    }

    container.innerHTML = items.map((item, i) => renderRow(item, i)).join('');

    if (onRowClick) {
        container.querySelectorAll('[data-id]').forEach(row => {
            row.addEventListener('click', () => onRowClick(row.dataset.id, row));
        });
    }
}
