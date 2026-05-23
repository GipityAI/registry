// main.js - Entry point: register routes, init router + command palette

import { initConfig } from './config.js';
import { registerRoute, initRouter, updateSidebarActive, renderRoute } from './router.js';
import { initCommandPalette } from './command-palette.js';

// Agent pages
import { renderAgentHome } from './pages/agent/home.js';
import { renderIncidents } from './pages/agent/incidents.js';
import { renderIncidentNew } from './pages/agent/incident-new.js';
import { renderKnowledge } from './pages/agent/knowledge.js';
import { renderSla } from './pages/agent/sla.js';
import { renderApprovals } from './pages/agent/approvals.js';
import { renderReports } from './pages/agent/reports.js';
import { renderSettings } from './pages/agent/settings.js';
import { renderMajorIncident } from './pages/agent/incident-mim.js';

// Portal pages
import { renderPortalHome } from './pages/portal/home.js';
import { renderReportIssue } from './pages/portal/report-issue.js';
import { renderCatalog } from './pages/portal/catalog.js';
import { renderMyRequests } from './pages/portal/my-requests.js';

// ---- Register Routes ----

// Portal routes (employee self-service)
registerRoute('/', renderPortalHome);
registerRoute('/portal', renderPortalHome);
registerRoute('/portal/report', renderReportIssue);
registerRoute('/portal/catalog', renderCatalog);
registerRoute('/portal/requests', renderMyRequests);
// Legacy paths
registerRoute('/report-issue', renderReportIssue);
registerRoute('/catalog', renderCatalog);
registerRoute('/my-requests', renderMyRequests);

// Agent routes
registerRoute('/agent', renderAgentHome);
registerRoute('/agent/incidents', renderIncidents);
registerRoute('/agent/incidents/new', renderIncidentNew);
registerRoute('/agent/incidents/:id/mim', renderMajorIncident);
registerRoute('/agent/knowledge', renderKnowledge);
registerRoute('/agent/sla', renderSla);
registerRoute('/agent/approvals', renderApprovals);
registerRoute('/agent/reports', renderReports);
registerRoute('/agent/settings', renderSettings);

// ---- Sidebar Visibility ----

function updateLayout() {
    const sidebar = document.getElementById('sidebar');
    const path = location.pathname;

    // Strip the Gipity hosting prefix (/steve/gipitsm/) to get the app path
    const basePath = document.querySelector('base')?.href || '';

    const isAgent = path.includes('/agent');
    if (sidebar) {
        sidebar.classList.toggle('hidden', !isAgent);
    }
    updateSidebarActive();
}

// Listen for route changes
window.addEventListener('popstate', updateLayout);
document.addEventListener('click', (e) => {
    if (e.target.closest('a[data-link]')) {
        requestAnimationFrame(updateLayout);
    }
});

// ---- Initialize ----

document.addEventListener('DOMContentLoaded', () => {
    initConfig();
    initCommandPalette();
    initRouter();
    updateLayout();
});
