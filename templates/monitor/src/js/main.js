/**
 * Monitor — sidebar-nav dashboard orchestrator.
 * - Auth gate via Sign in with Gipity (cookie).
 * - Left sidebar grouped into ACTIVITY / PROJECT / ACCOUNT:
 *   - Activity: Traffic / Errors / Chats / Audit        (event streams)
 *   - Project:  Compute / Data / Services / Hosting     (resources)
 *   - Account:  Plan / Spend / Devices / Alerts         (account state)
 * - URL hash preserves the active tab + sub-tab across reloads.
 * - Range + Project filters re-render the active tab on change.
 */
import { api } from './api.js';
import { signIn, isSignedIn } from './auth.js';
import { renderTrafficTab } from './tabs/traffic.js';
import { renderActivityTab } from './tabs/activity.js';
import { renderErrorsTab } from './tabs/errors.js';
import { renderServicesTab } from './tabs/services.js';
import { renderChatsTab } from './tabs/chats.js';
import { renderAuditTab } from './tabs/audit.js';
import { renderAlertsTab } from './tabs/alerts.js';
import { renderComputeTab } from './tabs/compute.js';
import { renderDataTab } from './tabs/data.js';
import { renderHostingTab } from './tabs/hosting.js';
import { renderSpendTab } from './tabs/spend.js';
import { renderPlanTab } from './tabs/plan.js';
import { renderDevicesTab } from './tabs/devices.js';
import { deployAnnotationPlugin, applyChartTheme } from './chart-helpers.js';

// Globally register the deploy-annotation overlay so each tab just needs to
// set `chart.$annotations` from the timeseries response, and apply the Monitor
// chart theme (readable tick / grid colors on the dark surface).
// eslint-disable-next-line no-undef
if (typeof Chart !== 'undefined') Chart.register(deployAnnotationPlugin);
applyChartTheme();

const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let currentTab = 'traffic';
let currentAuditType = 'auth';

function currentFilters() {
  // The picker's value is ALWAYS a project short_guid. Both `appGuid` and
  // `projectId` below hold that same string — `projectId` is a historical
  // alias kept so legacy tab call-sites still destructure cleanly.
  //
  // WARNING: the `projectId` alias is a contract trap. The integer project_id
  // never appears in the client. When wiring a client helper, ALWAYS send the
  // value as `app_guid=...` on the wire. The server resolves short_guid →
  // numeric id via `resolveProjectFilter` (see platform CLAUDE.md "Project
  // filter contract"). Helpers that send `project_id=<shortguid>` instead
  // silently fail Zod coercion — chats + audit shipped that way and the
  // picker quietly stopped working on those tabs.
  const guid = $('project-filter').value || undefined;
  return { range: $('range').value, appGuid: guid, projectId: guid };
}

function showTab(name) {
  currentTab = name;
  $$('.sidebar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel').forEach((p) => { p.hidden = p.dataset.tab !== name; });
  // Preserve `#services/<sub>` when re-clicking Services — only clobber the
  // hash when actually switching to a different top-level tab.
  const baseHash = location.hash.slice(1).split('/')[0];
  if (baseHash !== name) location.hash = name;
  renderActiveTab().catch((err) => console.error('[monitor] tab render failed', err));
}

// CSV export per tab — only tabs that surface a flat list endpoint where
// "export this view" makes sense. The button lives at the bottom of the tab,
// as a muted link; tabs absent from this map don't render a CSV control.
const CSV_ENDPOINTS = {
  traffic:  { path: '/account/logs/traffic' },
  errors:   { path: '/account/logs/errors' },
  services: { path: '/account/logs/services' },
  chats:    { path: '/account/logs/chats' },
  audit:    { path: '/account/logs/audit' },
};

function downloadCsv(signal) {
  const entry = CSV_ENDPOINTS[signal];
  if (!entry) return;
  const filters = currentFilters();
  const params = new URLSearchParams();
  if (filters.appGuid) params.set('app_guid', filters.appGuid);
  if (filters.range) params.set('range', filters.range);
  if (signal === 'audit') params.set('type', currentAuditType);
  for (const [k, v] of Object.entries(entry.extra || {})) params.set(k, v);
  params.set('format', 'csv');
  window.location.href = `https://a.gipity.ai${entry.path}?${params.toString()}`;
}

async function renderActiveTab() {
  const filters = currentFilters();
  try {
    switch (currentTab) {
      case 'traffic':   return await renderTrafficTab(api, filters);
      case 'activity':  return await renderActivityTab(api, filters);
      case 'errors':    return await renderErrorsTab(api, filters);
      case 'services':  return await renderServicesTab(api, filters);
      case 'compute':   return await renderComputeTab(api, filters);
      case 'data':      return await renderDataTab(api, filters);
      case 'hosting':   return await renderHostingTab(api, filters);
      case 'spend':     return await renderSpendTab(api, filters);
      case 'plan':      return await renderPlanTab(api, filters);
      case 'chats':     return await renderChatsTab(api, filters);
      case 'devices':   return await renderDevicesTab(api, filters);
      case 'audit':     return await renderAuditTab(api, { ...filters, type: currentAuditType });
      case 'alerts':    return await renderAlertsTab(api, filters);
    }
  } catch (err) {
    if (err.message === 'UNAUTHENTICATED') showAuthGate();
    else throw err;
  }
}

async function populateProjectFilter() {
  try {
    // Use /account/logs/projects (lists every project the user owns) rather
    // than /apps (which only returns projects with telemetry rows).
    const res = await api.projects();
    const sel = $('project-filter');
    const current = sel.value;
    sel.innerHTML = '<option value="">All projects</option>';
    for (const p of res.data) {
      const opt = document.createElement('option');
      opt.value = p.short_guid;
      opt.textContent = p.name;
      sel.appendChild(opt);
    }
    if (current) sel.value = current;
  } catch (err) {
    if (err.message === 'UNAUTHENTICATED') showAuthGate();
    else console.error('[monitor] projects failed', err);
  }
}

function showAuthGate() {
  $('auth-gate').hidden = false;
  $('dashboard').hidden = true;
}
function showDashboard() {
  $('auth-gate').hidden = true;
  $('dashboard').hidden = false;
}

/**
 * Wire the sidebar splitter — drag the 2px rail to resize the nav, persist the
 * width to localStorage. Clamps between a sensible min (140px, labels still
 * fit) and max (320px, beyond which the nav becomes a left panel).
 */
function initSidebarSplitter() {
  const sidebar = document.querySelector('.sidebar');
  const splitter = $('sidebar-splitter');
  if (!sidebar || !splitter) return;
  const MIN = 140, MAX = 320, KEY = 'monitor.sidebarWidth';
  const saved = parseInt(localStorage.getItem(KEY) || '', 10);
  if (saved >= MIN && saved <= MAX) sidebar.style.width = `${saved}px`;

  let dragging = false;
  splitter.addEventListener('mousedown', (ev) => {
    dragging = true;
    splitter.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    ev.preventDefault();
  });
  window.addEventListener('mousemove', (ev) => {
    if (!dragging) return;
    const rect = sidebar.getBoundingClientRect();
    const next = Math.min(MAX, Math.max(MIN, ev.clientX - rect.left));
    sidebar.style.width = `${next}px`;
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const w = parseInt(sidebar.style.width, 10);
    if (w >= MIN && w <= MAX) localStorage.setItem(KEY, String(w));
  });
}

async function init() {
  initSidebarSplitter();

  // Tab clicks
  $$('.sidebar button').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  // Hash routing
  const initialTab = location.hash.slice(1);
  // Initial tab from URL hash. `services/<sub>` deep-links into a Services sub-tab.
  const baseTab = initialTab.split('/')[0];
  if (['traffic', 'activity', 'errors', 'services', 'compute', 'data', 'hosting', 'spend', 'plan', 'chats', 'devices', 'audit', 'alerts'].includes(baseTab)) {
    currentTab = baseTab;
    $$('.sidebar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === baseTab));
    $$('.tab-panel').forEach((p) => { p.hidden = p.dataset.tab !== baseTab; });
  }
  window.addEventListener('hashchange', () => {
    const name = location.hash.slice(1).split('/')[0];
    if (name && name !== currentTab) showTab(name);
  });

  // Audit sub-tabs
  $$('[data-audit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('[data-audit]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentAuditType = btn.dataset.audit;
      if (currentTab === 'audit') renderActiveTab();
    });
  });

  // Filter changes
  $('refresh').addEventListener('click', () => renderActiveTab());
  $('range').addEventListener('change', () => renderActiveTab());
  $('project-filter').addEventListener('change', () => renderActiveTab());

  // Per-tab CSV buttons live inside each tab footer; one delegated listener
  // covers all of them so new tabs only need the button markup.
  document.querySelectorAll('.export-csv-btn').forEach((btn) => {
    btn.addEventListener('click', () => downloadCsv(btn.dataset.export));
  });

  // Sign-in
  $('signin').addEventListener('click', async () => {
    try {
      await signIn();
      showDashboard();
      await populateProjectFilter();
      await renderActiveTab();
    } catch (err) {
      alert(`Sign-in failed: ${err.message}`);
    }
  });

  if (await isSignedIn()) {
    showDashboard();
    await populateProjectFilter();
    await renderActiveTab();
  } else {
    showAuthGate();
  }
}

init();
