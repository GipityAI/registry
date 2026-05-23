// pages/portal/home.js - Self-service portal: search hero, KB deflection, quick actions, my open items

import { searchKB, listRecords } from '../../api.js';
import { el, escapeHtml, debounce, timeAgo, stateBadge } from '../../utils.js';
import { navigate } from '../../router.js';

export function renderPortalHome() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <div class="portal-layout">
            <div class="portal-hero">
                <h1>How can we help?</h1>
                <div class="search-bar" style="max-width: 560px; margin: 0 auto;">
                    <input type="text" id="portal-search" placeholder="Search for help or describe your issue..."
                           style="font-size: var(--text-md); padding: var(--sp-3) var(--sp-4) var(--sp-3) var(--sp-8);">
                </div>
                <div id="portal-deflection" style="max-width: 560px; margin: var(--sp-2) auto 0;"></div>
            </div>

            <div class="quick-actions" style="margin-bottom: var(--sp-8);">
                <div class="quick-action-card" id="qa-report">
                    <h3>Report an Issue</h3>
                    <p>Something broken? Let us know and we'll fix it.</p>
                </div>
                <div class="quick-action-card" id="qa-catalog">
                    <h3>Request Something</h3>
                    <p>New hardware, software, access, or services.</p>
                </div>
                <div class="quick-action-card" id="qa-requests">
                    <h3>My Requests</h3>
                    <p>Track your open incidents and service requests.</p>
                </div>
            </div>

            <div style="margin-bottom: var(--sp-8);">
                <h2 class="section-title">Popular from the Catalog</h2>
                <div id="popular-catalog" class="catalog-grid">
                    <div class="skeleton skeleton-box"></div>
                </div>
            </div>

            <div>
                <h2 class="section-title">My Open Items</h2>
                <div id="my-open-items">
                    <div class="skeleton skeleton-box"></div>
                </div>
            </div>
        </div>
    `;

    // Quick action navigation
    document.getElementById('qa-report')?.addEventListener('click', () => navigate('/report-issue'));
    document.getElementById('qa-catalog')?.addEventListener('click', () => navigate('/catalog'));
    document.getElementById('qa-requests')?.addEventListener('click', () => navigate('/my-requests'));

    // Search deflection
    setupSearchDeflection();
    loadPopularCatalog();
    loadMyOpenItems();
}

function setupSearchDeflection() {
    const input = document.getElementById('portal-search');
    const container = document.getElementById('portal-deflection');
    if (!input || !container) return;

    const search = debounce(async (query) => {
        if (query.length < 4) {
            container.innerHTML = '';
            return;
        }

        try {
            const result = await searchKB(query);
            const articles = result?.rows || result?.data || [];

            if (articles.length === 0) {
                container.innerHTML = '';
                return;
            }

            container.innerHTML = `
                <div class="deflection-results" style="text-align: left;">
                    <h4>These articles might help</h4>
                    ${articles.slice(0, 4).map((a) => `
                        <div class="deflection-item" data-id="${a.id}">
                            ${escapeHtml(a.title)}
                        </div>
                    `).join('')}
                    <div style="padding: var(--sp-2); font-size: var(--text-xs); color: var(--text-faint);">
                        Still need help? <a href="/report-issue" data-link>Report an issue</a>
                    </div>
                </div>
            `;
        } catch {
            container.innerHTML = '';
        }
    }, 400);

    input.addEventListener('input', () => search(input.value.trim()));
}

async function loadPopularCatalog() {
    const container = document.getElementById('popular-catalog');
    if (!container) return;

    try {
        const result = await listRecords('catalog_items', {
            filters: { is_active: true },
            sort: { order_count: 'desc' },
            limit: 4,
        });
        const items = result?.rows || result?.data || [];

        if (items.length === 0) {
            container.innerHTML = '<p style="color: var(--text-faint); font-size: var(--text-sm);">No catalog items available.</p>';
            return;
        }

        container.innerHTML = '';
        items.forEach((item) => {
            const card = el('div', {
                className: 'catalog-card',
                onClick: () => navigate('/catalog'),
            });
            card.innerHTML = `
                <h3>${escapeHtml(item.name)}</h3>
                <p>${escapeHtml(item.description || '')}</p>
                <div class="catalog-card-meta">
                    <span>${item.delivery_days === 0 ? 'Instant' : `${item.delivery_days} day${item.delivery_days > 1 ? 's' : ''}`}</span>
                    ${item.price > 0 ? `<span>$${item.price}</span>` : '<span>Free</span>'}
                </div>
            `;
            container.appendChild(card);
        });
    } catch (err) {
        container.innerHTML = '<p style="color: var(--text-faint); font-size: var(--text-sm);">Failed to load catalog.</p>';
    }
}

async function loadMyOpenItems() {
    const container = document.getElementById('my-open-items');
    if (!container) return;

    try {
        // Load recent incidents and requests for current user
        const incResult = await listRecords('incidents', {
            filters: { state: ['new', 'in_progress', 'on_hold'] },
            sort: { created_at: 'desc' },
            limit: 5,
        });
        const reqResult = await listRecords('service_requests', {
            filters: { state: ['pending', 'approved', 'in_progress'] },
            sort: { created_at: 'desc' },
            limit: 5,
        });

        const incidents = incResult?.rows || incResult?.data || [];
        const requests = reqResult?.rows || reqResult?.data || [];

        if (incidents.length === 0 && requests.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No open items. You\'re all set!</p></div>';
            return;
        }

        let html = '';
        incidents.forEach((inc) => {
            html += `
                <div class="ticket-row" style="cursor: default;">
                    <div class="ticket-row-header">
                        <span class="ticket-row-number">${escapeHtml(inc.number)}</span>
                        ${stateBadge(inc.state)}
                    </div>
                    <div class="ticket-row-title">${escapeHtml(inc.short_description)}</div>
                    <div class="ticket-row-meta">
                        <span>Incident</span>
                        <span>${timeAgo(inc.created_at)}</span>
                    </div>
                </div>
            `;
        });
        requests.forEach((req) => {
            html += `
                <div class="ticket-row" style="cursor: default;">
                    <div class="ticket-row-header">
                        <span class="ticket-row-number">${escapeHtml(req.number)}</span>
                        ${stateBadge(req.state)}
                    </div>
                    <div class="ticket-row-title">${escapeHtml(req.catalog_item_name || 'Service Request')}</div>
                    <div class="ticket-row-meta">
                        <span>Request</span>
                        <span>${timeAgo(req.created_at)}</span>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<p style="color: var(--text-faint); font-size: var(--text-sm);">Failed to load your items.</p>';
    }
}
