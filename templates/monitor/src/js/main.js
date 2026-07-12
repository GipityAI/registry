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
import { renderSecretsTab } from './tabs/secrets.js';
import { renderComputeTab } from './tabs/compute.js';
import { renderDataTab } from './tabs/data.js';
import { renderHostingTab } from './tabs/hosting.js';
import { renderSpendTab } from './tabs/spend.js';
import { renderPlanTab } from './tabs/plan.js';
import { renderDevicesTab } from './tabs/devices.js';
import { deployAnnotationPlugin, applyChartTheme } from './chart-helpers.js';
import { initThemePicker } from './theme.js';
import { setRenderer, beginTabLoad, endTabLoad, showTabError, hashPath, setHashPath } from './ui.js';

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

// Persisted view state — survive reloads so the dashboard reopens the way the
// user left it (sidebar width already persists via its own key below).
const KEY_RANGE = 'monitor.range';
const KEY_PROJECT = 'monitor.project';
const KEY_AUTO = 'monitor.autoRefresh';

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
  // hash when actually switching to a different top-level tab. setHashPath
  // keeps the `?project=…&range=…` filter params either way.
  const baseHash = hashPath().split('/')[0];
  if (baseHash !== name) setHashPath(name);
  renderActiveTab();
}

// ── Deep-linkable filters ────────────────────────────────────────────────────
// The hash carries the filters too: `#<tab>[/<sub>]?project=<slug|guid>&range=<r>`.
// Reads accept a project slug, short_guid, or name; writes prefer the slug
// (readable URLs). Filter writes use history.replaceState so dragging the
// selects around doesn't pollute history or re-fire hashchange.

/** slug → guid + name lookups, filled by populateProjectFilter. */
let projectLookup = [];

/** The ?query params currently in the hash. */
function hashParams() {
  const raw = location.hash.slice(1);
  const q = raw.indexOf('?');
  return new URLSearchParams(q === -1 ? '' : raw.slice(q + 1));
}

/** Resolve a `project=` param (slug, short_guid, or name) to a picker guid. */
function resolveProjectParam(value) {
  if (!value) return '';
  const v = value.toLowerCase();
  const hit = projectLookup.find(
    (p) => p.short_guid === value || p.slug?.toLowerCase() === v || p.name?.toLowerCase() === v,
  );
  return hit?.short_guid ?? '';
}

/** Mirror the current Range + Project selection into the hash query. */
function syncHashFilters() {
  const params = hashParams();
  const guid = $('project-filter').value;
  const slug = projectLookup.find((p) => p.short_guid === guid)?.slug;
  if (guid) params.set('project', slug || guid);
  else params.delete('project');
  params.set('range', $('range').value);
  const query = params.toString();
  history.replaceState(null, '', `#${hashPath()}${query ? `?${query}` : ''}`);
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

const TAB_RENDERERS = {
  traffic: renderTrafficTab,
  activity: renderActivityTab,
  errors: renderErrorsTab,
  services: renderServicesTab,
  compute: renderComputeTab,
  data: renderDataTab,
  hosting: renderHostingTab,
  spend: renderSpendTab,
  plan: renderPlanTab,
  chats: renderChatsTab,
  devices: renderDevicesTab,
  audit: renderAuditTab,
  alerts: renderAlertsTab,
  secrets: renderSecretsTab,
};

let rendering = false;
let lastUpdatedAt = null;

function updateFreshness() {
  const el = $('freshness');
  if (!el || !lastUpdatedAt) return;
  const s = Math.max(0, Math.round((Date.now() - lastUpdatedAt) / 1000));
  el.textContent = s < 60 ? `Updated ${s}s ago` : `Updated ${Math.round(s / 60)}m ago`;
}

async function renderActiveTab() {
  const render = TAB_RENDERERS[currentTab];
  if (!render) return;
  const panel = document.querySelector(`.tab-panel[data-tab="${currentTab}"]`);
  const refreshBtn = $('refresh');
  const filters = currentTab === 'audit'
    ? { ...currentFilters(), type: currentAuditType }
    : currentFilters();
  rendering = true;
  refreshBtn.disabled = true;
  refreshBtn.classList.add('busy');
  beginTabLoad(panel);
  try {
    await render(api, filters);
    lastUpdatedAt = Date.now();
    updateFreshness();
  } catch (err) {
    if (err.message === 'UNAUTHENTICATED') { showAuthGate(); return; }
    console.error('[monitor] tab render failed', err);
    showTabError(panel, err);
  } finally {
    rendering = false;
    endTabLoad(panel);
    refreshBtn.classList.remove('busy');
    refreshBtn.disabled = false;
  }
}

// ── Auto-refresh + live pulse ──────────────────────────────────────────────
// Off / 30s / 60s, persisted. Refreshes the ACTIVE tab only, and only while
// the page is visible. The header live-pulse (realtime CCU) updates on the
// same cadence — plus once at load — so "N live now" stays honest.
let autoTimer = null;

async function updateLivePulse() {
  try {
    const res = await api.realtimeLive();
    $('live-count').textContent = String(res.data.live_ccu ?? 0);
    $('live-pulse').hidden = false;
  } catch { /* decorative — never surface an error for the pulse */ }
}

function applyAutoRefresh() {
  const secs = Number($('auto-refresh').value) || 0;
  localStorage.setItem(KEY_AUTO, String(secs));
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  if (!secs) return;
  autoTimer = setInterval(() => {
    if (document.visibilityState !== 'visible' || rendering || $('dashboard').hidden) return;
    renderActiveTab();
    updateLivePulse();
  }, secs * 1000);
}

async function populateProjectFilter() {
  try {
    // Use /account/logs/projects (lists every project the user owns) rather
    // than /apps (which only returns projects with telemetry rows).
    const res = await api.projects();
    projectLookup = res.data;
    const sel = $('project-filter');
    const current = sel.value;
    sel.innerHTML = '<option value="">All projects</option>';
    for (const p of res.data) {
      const opt = document.createElement('option');
      opt.value = p.short_guid;
      opt.textContent = p.name;
      sel.appendChild(opt);
    }
    // Precedence: a `?project=` deep-link param (resolvable only now that the
    // options exist), else the in-page selection, else the persisted one — and
    // only when that project still exists in the list.
    const fromHash = resolveProjectParam(hashParams().get('project'));
    const want = fromHash || current || localStorage.getItem(KEY_PROJECT) || '';
    if (want && Array.from(sel.options).some((o) => o.value === want)) sel.value = want;
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
  setRenderer(renderActiveTab);
  initSidebarSplitter();

  // Tab clicks
  $$('.sidebar button').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  // Restore Range: a `?range=` deep-link param wins, else the persisted one.
  // (Project restores in populateProjectFilter once the options exist.)
  const rangeParam = hashParams().get('range');
  const savedRange = rangeParam || localStorage.getItem(KEY_RANGE);
  if (savedRange && $('range').querySelector(`option[value="${savedRange}"]`)) {
    $('range').value = savedRange;
  }

  // Hash routing
  // Initial tab from URL hash. `<tab>/<sub>` deep-links into a sub-tab —
  // services/compute/data/hosting handle their own sub part; audit's is here.
  // Filter params (`?project=…&range=…`) ride behind the path — see
  // hashParams()/syncHashFilters().
  const [baseTab, subPart] = hashPath().split('/');
  if (['traffic', 'activity', 'errors', 'services', 'compute', 'data', 'hosting', 'spend', 'plan', 'chats', 'devices', 'audit', 'alerts', 'secrets'].includes(baseTab)) {
    currentTab = baseTab;
    $$('.sidebar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === baseTab));
    $$('.tab-panel').forEach((p) => { p.hidden = p.dataset.tab !== baseTab; });
  }
  if (baseTab === 'audit' && ['auth', 'upload', 'secret'].includes(subPart)) {
    currentAuditType = subPart;
    $$('[data-audit]').forEach((b) => b.classList.toggle('active', b.dataset.audit === subPart));
  }
  window.addEventListener('hashchange', () => {
    const name = hashPath().split('/')[0];
    if (name && name !== currentTab) showTab(name);
  });

  // Audit sub-tabs — mirror the other sub-tab strips: reflect the selection
  // in the hash (`#audit/<type>`) so reloads land on the same view.
  $$('[data-audit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('[data-audit]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentAuditType = btn.dataset.audit;
      if (hashPath().split('/')[0] === 'audit') setHashPath(`audit/${currentAuditType}`);
      if (currentTab === 'audit') renderActiveTab();
    });
  });

  // Theme picker — re-read the CSS tokens into Chart.js defaults and re-render
  // the active tab so the charts (which can't resolve CSS var()s) follow the theme.
  initThemePicker(() => {
    applyChartTheme();
    renderActiveTab();
  });

  // Filter changes — persist, then re-render.
  $('refresh').addEventListener('click', () => renderActiveTab());
  $('range').addEventListener('change', () => {
    localStorage.setItem(KEY_RANGE, $('range').value);
    syncHashFilters();
    renderActiveTab();
  });
  $('project-filter').addEventListener('change', () => {
    localStorage.setItem(KEY_PROJECT, $('project-filter').value);
    syncHashFilters();
    renderActiveTab();
  });

  // Auto-refresh + freshness ticker
  const savedAuto = localStorage.getItem(KEY_AUTO);
  if (savedAuto && $('auto-refresh').querySelector(`option[value="${savedAuto}"]`)) {
    $('auto-refresh').value = savedAuto;
  }
  $('auto-refresh').addEventListener('change', applyAutoRefresh);
  applyAutoRefresh();
  setInterval(updateFreshness, 1000);

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
      updateLivePulse();
    } catch (err) {
      alert(`Sign-in failed: ${err.message}`);
    }
  });

  if (await isSignedIn()) {
    showDashboard();
    await populateProjectFilter();
    await renderActiveTab();
    updateLivePulse();
  } else {
    showAuthGate();
  }
}

init();
