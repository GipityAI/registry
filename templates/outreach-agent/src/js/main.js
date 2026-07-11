// App shell: Sign in with Gipity gate + sidebar + hash router. The SiwG sign-in
// lands the session cookie on a.gipity.ai, which authorizes BOTH Gipity.fn (this
// app's functions) and the platform rules/learn bridge.
import { api } from './api.js';
import { $, toast } from './util.js';
import { renderDashboard } from './views/dashboard.js';
import { renderApprovals } from './views/approvals.js';
import { renderPlaybook } from './views/playbook.js';
import { renderContacts, renderContactDetail } from './views/contacts.js';
import { renderCandidates } from './views/candidates.js';
import { renderImport } from './views/import.js';
import { renderFunnels } from './views/funnels.js';
import { renderSettings } from './views/settings.js';

// A tiny shared store so any view can read cached settings (esp. agent_guid).
export const store = { settings: null };
export async function loadSettings(force) {
    if (!store.settings || force) {
        try { store.settings = (await api.settings.get()).settings || {}; } catch { store.settings = {}; }
    }
    return store.settings;
}

const gate = $('gate');
const app = $('app');
const viewEl = $('view');

const routes = [
    { re: /^#\/approvals\/?$/, name: 'approvals', run: () => renderApprovals(viewEl) },
    { re: /^#\/playbook\/?$/, name: 'playbook', run: () => renderPlaybook(viewEl) },
    { re: /^#\/contacts\/([^/]+)$/, name: 'contacts', run: (m) => renderContactDetail(viewEl, m[1]) },
    { re: /^#\/contacts\/?$/, name: 'contacts', run: () => renderContacts(viewEl) },
    { re: /^#\/candidates\/?$/, name: 'candidates', run: () => renderCandidates(viewEl) },
    { re: /^#\/import\/?$/, name: 'import', run: () => renderImport(viewEl) },
    { re: /^#\/funnel\/?$/, name: 'funnel', run: () => renderFunnels(viewEl) },
    { re: /^#\/settings\/?$/, name: 'settings', run: () => renderSettings(viewEl) },
    { re: /.*/, name: 'dashboard', run: () => renderDashboard(viewEl) },
];

function router() {
    const hash = location.hash || '#/dashboard';
    const route = routes.find((r) => r.re.test(hash));
    const m = hash.match(route.re);
    document.querySelectorAll('#nav a[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === route.name));
    window.scrollTo(0, 0);
    route.run(m);
}

export async function refreshNavBadges() {
    try {
        const d = await api.dashboard();
        const setBadge = (id, n) => { const el = $(id); if (!el) return; if (n > 0) { el.textContent = n; el.hidden = false; } else el.hidden = true; };
        setBadge('nav-appr-count', d.pending || 0);
        setBadge('nav-cand-count', d.candidates || 0);
    } catch { /* ignore */ }
}

function showApp(user) {
    gate.hidden = true;
    app.hidden = false;
    $('user-name').textContent = user?.displayName || user?.email || '';
    window.addEventListener('hashchange', router);
    router();
    refreshNavBadges();
}

function showGate(msg) {
    app.hidden = true;
    gate.hidden = false;
    const m = $('gate-msg');
    if (msg) { m.textContent = msg; m.hidden = false; }
}

async function waitForGipity() {
    for (let i = 0; i < 60 && !window.Gipity; i++) await new Promise((r) => setTimeout(r, 100));
    return Boolean(window.Gipity);
}

async function boot() {
    if (!(await waitForGipity())) { showGate('Could not load the Gipity client. Refresh to retry.'); return; }

    $('signin-btn').addEventListener('click', async () => {
        try {
            const user = await window.Gipity.auth.signIn();
            if (user) { await loadSettings(true); showApp(user); }
            else showGate('Sign-in was cancelled or not permitted.');
        } catch (err) { showGate(err?.message || 'Sign-in failed.'); }
    });
    $('signout-btn').addEventListener('click', async () => {
        try { await window.Gipity.auth.signOut(); } catch { /* ignore */ }
        store.settings = null;
        location.hash = '#/dashboard';
        showGate('Signed out.');
    });

    const me = await window.Gipity.auth.user().catch(() => null);
    if (me) { await loadSettings(true); showApp(me); }
    else showGate();
}

window.toast = toast;
document.addEventListener('DOMContentLoaded', boot);
