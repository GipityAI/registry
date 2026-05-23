// components/kb-deflection.js - Reusable KB search deflection for forms

import { searchKB } from '../api.js';
import { escapeHtml, debounce } from '../utils.js';
import { navigate } from '../router.js';

/**
 * Set up KB deflection on an input field.
 * Shows matching KB articles as the user types, helping them self-serve.
 *
 * @param {HTMLInputElement} input - The text input to watch
 * @param {HTMLElement} container - Where to render deflection results
 * @param {object} options - { minLength, debounceMs, maxResults, onArticleClick }
 */
export function setupKBDeflection(input, container, options = {}) {
    const minLength = options.minLength || 8;
    const debounceMs = options.debounceMs || 400;
    const maxResults = options.maxResults || 3;
    const onArticleClick = options.onArticleClick || ((article) => {
        navigate(`/agent/knowledge/${article.id}`);
    });

    const search = debounce(async (query) => {
        if (query.length < minLength) {
            container.style.display = 'none';
            return;
        }
        try {
            const result = await searchKB(query);
            const articles = result.data || [];
            if (articles.length === 0) {
                container.style.display = 'none';
                return;
            }

            container.style.display = 'block';
            container.innerHTML = `
                <div class="card" style="border-color: var(--info); border-left: 3px solid var(--info);">
                    <div class="card-title" style="color: var(--info);">Try this first</div>
                    ${articles.slice(0, maxResults).map(a => `
                        <div class="deflection-article" data-id="${a.id}" style="padding: var(--sp-2) 0; border-bottom: 1px solid var(--border); cursor: pointer;">
                            <div style="font-weight: 500; font-size: var(--text-sm); color: var(--primary);">${escapeHtml(a.title)}</div>
                            <div style="font-size: var(--text-xs); color: var(--text-2); margin-top: 2px;">
                                ${escapeHtml((a.body || '').replace(/<[^>]+>/g, '').substring(0, 120))}...
                            </div>
                        </div>
                    `).join('')}
                    <div style="font-size: var(--text-xs); color: var(--text-3); margin-top: var(--sp-2);">
                        Didn't help? Submit the form below.
                    </div>
                </div>
            `;

            container.querySelectorAll('.deflection-article').forEach(el => {
                el.addEventListener('click', () => {
                    const id = el.dataset.id;
                    const article = articles.find(a => String(a.id) === id);
                    if (article) onArticleClick(article);
                });
            });
        } catch (err) {
            console.error('KB deflection search failed:', err);
            container.style.display = 'none';
        }
    }, debounceMs);

    input.addEventListener('input', () => search(input.value.trim()));
}
