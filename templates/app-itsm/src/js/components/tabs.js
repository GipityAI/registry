// components/tabs.js - Reusable tab switching

/**
 * Initialize tab switching on a set of tab buttons and panels.
 *
 * @param {HTMLElement} container - Parent element containing .tab and .tab-panel elements
 * @param {string} panelPrefix - ID prefix for panels (e.g., 'tab' → looks for #tab-{key})
 * @param {function} [onTabChange] - Optional callback (tabKey) => void
 */
export function initTabs(container, panelPrefix = 'tab', onTabChange = null) {
    const tabs = container.querySelectorAll('.tab[data-tab]');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Deactivate all
            tabs.forEach(t => t.classList.remove('active'));
            container.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
            // Activate clicked
            tab.classList.add('active');
            const panel = document.getElementById(`${panelPrefix}-${tab.dataset.tab}`);
            if (panel) panel.classList.remove('hidden');
            if (onTabChange) onTabChange(tab.dataset.tab);
        });
    });
}
