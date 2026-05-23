// pages/agent/knowledge.js - Split-pane KB article list + detail viewer/editor

import { listRecords, getRecord, createRecord, updateRecord } from '../../api.js';
import { el, escapeHtml, timeAgo, stateBadge, showToast } from '../../utils.js';

let selectedArticleId = null;
let currentStateFilter = 'all';
let isEditing = false;

const STATE_FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'published', label: 'Published' },
    { key: 'draft', label: 'Draft' },
    { key: 'review', label: 'Review' },
];

export function renderKnowledge() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <div class="page-header">
            <h1>Knowledge Base</h1>
            <div class="page-header-actions">
                <button class="btn btn-primary" id="btn-new-article">New Article</button>
            </div>
        </div>
        <div class="split-pane">
            <div class="split-list">
                <div class="split-list-header">
                    <div class="search-bar">
                        <input type="text" id="kb-search" placeholder="Search articles...">
                    </div>
                    <div class="filter-bar" id="kb-filters"></div>
                </div>
                <div class="split-list-body" id="kb-list">
                    <div class="skeleton skeleton-box" style="margin: var(--sp-3);"></div>
                </div>
            </div>
            <div class="split-detail" id="kb-detail">
                <div class="split-detail-empty">Select an article to view</div>
            </div>
        </div>
    `;

    renderStateFilters();
    loadArticleList();

    document.getElementById('btn-new-article')?.addEventListener('click', showNewArticleForm);
    document.getElementById('kb-search')?.addEventListener('input', (e) => {
        loadArticleList(e.target.value.trim());
    });
}

function renderStateFilters() {
    const container = document.getElementById('kb-filters');
    if (!container) return;
    container.innerHTML = '';

    STATE_FILTERS.forEach(({ key, label }) => {
        const chip = el('button', {
            className: `filter-chip ${key === currentStateFilter ? 'active' : ''}`,
            onClick: () => {
                currentStateFilter = key;
                renderStateFilters();
                loadArticleList();
            },
        }, label);
        container.appendChild(chip);
    });
}

async function loadArticleList(searchQuery = '') {
    const container = document.getElementById('kb-list');
    if (!container) return;

    try {
        const filters = {};
        if (currentStateFilter !== 'all') filters.state = currentStateFilter;

        const result = await listRecords('knowledge_articles', {
            filters,
            sort: { updated_at: 'desc' },
            limit: 50,
        });

        const articles = result?.rows || result?.data || [];
        let filtered = articles;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = articles.filter(
                (a) => a.title?.toLowerCase().includes(q) || a.category?.toLowerCase().includes(q)
            );
        }

        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No articles found</p></div>';
            return;
        }

        container.innerHTML = '';
        filtered.forEach((article) => {
            const row = el('div', {
                className: `ticket-row ${article.id === selectedArticleId ? 'selected' : ''}`,
                onClick: () => {
                    selectedArticleId = article.id;
                    isEditing = false;
                    loadArticleDetail(article.id);
                    container.querySelectorAll('.ticket-row').forEach((r) => r.classList.remove('selected'));
                    row.classList.add('selected');
                },
            });
            row.innerHTML = `
                <div class="ticket-row-header">
                    <span class="ticket-row-number">${escapeHtml(article.number)}</span>
                    ${stateBadge(article.state)}
                </div>
                <div class="ticket-row-title">${escapeHtml(article.title)}</div>
                <div class="ticket-row-meta">
                    <span>${escapeHtml(article.category || 'Uncategorized')}</span>
                    <span>${timeAgo(article.updated_at)}</span>
                    <span>${article.view_count || 0} views</span>
                </div>
            `;
            container.appendChild(row);
        });
    } catch (err) {
        console.error('Failed to load articles:', err);
        container.innerHTML = '<div class="empty-state"><p>Failed to load articles</p></div>';
    }
}

async function loadArticleDetail(id) {
    const container = document.getElementById('kb-detail');
    if (!container) return;

    container.innerHTML = '<div style="padding: var(--sp-6); text-align: center;"><span class="spinner spinner-lg"></span></div>';

    try {
        const result = await getRecord('knowledge_articles', id);
        const article = result?.row || result?.data || result;

        container.innerHTML = `
            <div style="padding: var(--sp-4) var(--sp-6); border-bottom: 1px solid var(--border); background: var(--bg-surface);">
                <div style="display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-2);">
                    <span style="color: var(--text-muted); font-size: var(--text-sm);">${escapeHtml(article.number)}</span>
                    ${stateBadge(article.state)}
                    <span style="font-size: var(--text-xs); color: var(--text-faint);">${escapeHtml(article.category || '')}</span>
                </div>
                <h2 style="font-size: var(--text-md);">${escapeHtml(article.title)}</h2>
                <div style="margin-top: var(--sp-3); display: flex; gap: var(--sp-2);">
                    <button class="btn btn-sm" id="btn-edit-article">Edit</button>
                    ${article.state === 'draft' || article.state === 'review' ?
                        '<button class="btn btn-sm btn-primary" id="btn-publish-article">Publish</button>' : ''}
                    ${article.state === 'published' ?
                        '<button class="btn btn-sm" id="btn-retire-article">Retire</button>' : ''}
                </div>
            </div>
            <div style="padding: var(--sp-6);">
                <div class="kb-body" id="kb-article-body">${article.body || '<p style="color: var(--text-faint);">No content</p>'}</div>
                <div style="margin-top: var(--sp-6); padding-top: var(--sp-4); border-top: 1px solid var(--border);">
                    <div class="field-grid">
                        <div class="field-item">
                            <span class="field-label">Views</span>
                            <span class="field-value">${article.view_count || 0}</span>
                        </div>
                        <div class="field-item">
                            <span class="field-label">Helpful</span>
                            <span class="field-value" style="color: var(--success);">${article.helpful_count || 0}</span>
                        </div>
                        <div class="field-item">
                            <span class="field-label">Not Helpful</span>
                            <span class="field-value" style="color: var(--danger);">${article.not_helpful_count || 0}</span>
                        </div>
                        <div class="field-item">
                            <span class="field-label">Last Updated</span>
                            <span class="field-value">${timeAgo(article.updated_at)}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('btn-edit-article')?.addEventListener('click', () => showEditForm(article));
        document.getElementById('btn-publish-article')?.addEventListener('click', () => changeState(id, 'published'));
        document.getElementById('btn-retire-article')?.addEventListener('click', () => changeState(id, 'retired'));
    } catch (err) {
        console.error('Failed to load article:', err);
        container.innerHTML = '<div class="empty-state"><p>Failed to load article</p></div>';
    }
}

function showEditForm(article) {
    const container = document.getElementById('kb-detail');
    if (!container) return;

    container.innerHTML = `
        <div style="padding: var(--sp-6);">
            <h2 style="margin-bottom: var(--sp-4);">Edit Article</h2>
            <form id="edit-article-form">
                <div class="form-group">
                    <label class="form-label">Title *</label>
                    <input type="text" class="form-input" id="edit-title" value="${escapeHtml(article.title)}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Category</label>
                    <input type="text" class="form-input" id="edit-category" value="${escapeHtml(article.category || '')}">
                </div>
                <div class="form-group">
                    <label class="form-label">Body (HTML)</label>
                    <textarea class="form-textarea" id="edit-body" rows="15">${escapeHtml(article.body || '')}</textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Visibility</label>
                    <select class="form-select" id="edit-visibility">
                        <option value="public" ${article.visibility === 'public' ? 'selected' : ''}>Public</option>
                        <option value="internal" ${article.visibility === 'internal' ? 'selected' : ''}>Internal</option>
                    </select>
                </div>
                <div style="display: flex; gap: var(--sp-3);">
                    <button type="submit" class="btn btn-primary">Save</button>
                    <button type="button" class="btn" id="btn-cancel-edit">Cancel</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('edit-article-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await updateRecord('knowledge_articles', article.id, {
                title: document.getElementById('edit-title')?.value?.trim(),
                category: document.getElementById('edit-category')?.value?.trim() || null,
                body: document.getElementById('edit-body')?.value,
                visibility: document.getElementById('edit-visibility')?.value,
            });
            showToast('Article updated', 'success');
            loadArticleDetail(article.id);
            loadArticleList();
        } catch (err) {
            showToast('Failed to update article', 'error');
        }
    });

    document.getElementById('btn-cancel-edit')?.addEventListener('click', () => {
        loadArticleDetail(article.id);
    });
}

function showNewArticleForm() {
    const container = document.getElementById('kb-detail');
    if (!container) return;

    container.innerHTML = `
        <div style="padding: var(--sp-6);">
            <h2 style="margin-bottom: var(--sp-4);">New Article</h2>
            <form id="new-article-form">
                <div class="form-group">
                    <label class="form-label">Title *</label>
                    <input type="text" class="form-input" id="new-title" required placeholder="Article title">
                </div>
                <div class="form-group">
                    <label class="form-label">Category</label>
                    <input type="text" class="form-input" id="new-category" placeholder="e.g., Network, Software">
                </div>
                <div class="form-group">
                    <label class="form-label">Body (HTML)</label>
                    <textarea class="form-textarea" id="new-body" rows="15" placeholder="<h2>Title</h2><p>Content...</p>"></textarea>
                </div>
                <div style="display: flex; gap: var(--sp-3);">
                    <button type="submit" class="btn btn-primary">Create Draft</button>
                </div>
            </form>
        </div>
    `;

    document.getElementById('new-article-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const result = await createRecord('knowledge_articles', {
                title: document.getElementById('new-title')?.value?.trim(),
                category: document.getElementById('new-category')?.value?.trim() || null,
                body: document.getElementById('new-body')?.value || '',
                state: 'draft',
                visibility: 'public',
            });
            showToast('Article created as draft', 'success');
            loadArticleList();
            const newId = result?.row?.id || result?.data?.id || result?.id;
            if (newId) {
                selectedArticleId = newId;
                loadArticleDetail(newId);
            }
        } catch (err) {
            showToast('Failed to create article', 'error');
        }
    });
}

async function changeState(id, newState) {
    try {
        await updateRecord('knowledge_articles', id, { state: newState });
        showToast(`Article ${newState}`, 'success');
        loadArticleDetail(id);
        loadArticleList();
    } catch (err) {
        showToast('Failed to update article state', 'error');
    }
}
