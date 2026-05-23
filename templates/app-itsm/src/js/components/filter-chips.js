// components/filter-chips.js - Reusable filter chip bar

/**
 * Render a set of filter chips.
 *
 * @param {HTMLElement} container - Where to render the chips
 * @param {object} filters - { key: { label: 'Display Name', ... }, ... }
 * @param {string} activeKey - Currently active filter key
 * @param {function} onSelect - (key) => void callback when a chip is clicked
 */
export function renderFilterChips(container, filters, activeKey, onSelect) {
    container.innerHTML = Object.entries(filters).map(([key, config]) =>
        `<span class="filter-chip${key === activeKey ? ' active' : ''}" data-key="${key}">${config.label || key}</span>`
    ).join('');

    container.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => onSelect(chip.dataset.key));
    });
}
