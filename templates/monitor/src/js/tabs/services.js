/**
 * Services tab — paid AI / media / realtime usage.
 *
 * Four sub-tabs, each rendering from log_services filtered by `service`:
 *   - LLMs     → service IN ('llm')
 *   - Speech   → service IN ('tts')
 *   - Media    → service IN ('image', 'audio', 'video')
 *   - Realtime → service IN ('realtime') + live CCU/rooms from the matchmaker
 *
 * Sub-tab state persists in the URL hash as `#services/<sub>` so reloads
 * keep the user where they were.
 */
import { fmtNum, fmtExact, fmtCredits, fmtMs, fmtPct, fmtTime, escapeHtml, statusPill, truncate, emptyRow, padSeries } from '../format.js';
import { groupFor } from '../chart-helpers.js';
import { renderRealtimePanel } from './realtime.js';

// USD → credits conversion (1 credit = $0.001). The Monitor surfaces credits
// everywhere user-facing — keeping a single unit so users don't have to
// translate between $ and credits when scanning cards / tables.
const USD_PER_CREDIT = 0.001;
const toCredits = (usd) => Number(usd) / USD_PER_CREDIT;

const $ = (id) => document.getElementById(id);
let currentSub = 'llm';
let bound = false;
const charts = {};
function destroy(key) { if (charts[key]) { charts[key].destroy(); delete charts[key]; } }

/** Read the sub-tab name from the URL hash (`#services/media` → `media`). */
function subFromHash() {
  const after = location.hash.slice(1).split('/')[1];
  return ['llm', 'tts', 'media', 'realtime', 'browser', 'search'].includes(after) ? after : 'llm';
}

function showSubTab(name) {
  currentSub = name;
  document.querySelectorAll('[data-svc-tab]').forEach((b) => b.classList.toggle('active', b.dataset.svcTab === name));
  document.querySelectorAll('[data-svc-panel]').forEach((p) => { p.hidden = p.dataset.svcPanel !== name; });
  if (location.hash.slice(1).split('/')[0] === 'services') location.hash = `services/${name}`;
}

/** Render the "paid services" view (LLMs / Speech / Media) — same structure, just a different service filter. */
async function renderPaidSubtab(api, key, filterSet, { range, projectId }) {
  const ids = {
    cost: `svc-${key}-cost`, calls: `svc-${key}-calls`, p95: `svc-${key}-p95`, err: `svc-${key}-err`,
    chartCost: `chart-svc-${key}-cost`, chartCalls: `chart-svc-${key}-calls`,
    tableModels: `table-svc-${key}-models`, tableCallers: `table-svc-${key}-callers`,
    tableRecent: `table-svc-${key}-recent`, tableKinds: `table-svc-${key}-kinds`,
  };

  // Recent + top-by-model use the `service` query parameter so each sub-tab
  // gets a narrow view (e.g. Speech shows only `service=tts`).
  // For 'media' we need an OR across image/audio/video; the API supports a
  // single value, so we fetch all three and merge client-side.
  const fetchPaidServices = async () => {
    if (filterSet.length === 1) {
      return api.services(undefined, filterSet[0], 50);
    }
    const results = await Promise.all(filterSet.map((s) => api.services(undefined, s, 50)));
    const merged = results.flatMap((r) => r.data || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 50);
    return { data: merged };
  };

  const [latency, callers, models, recent, statusBreakdown] = await Promise.all([
    api.latency('services', range, projectId),
    api.top('caller_user', range, 20, projectId),
    api.top('model', range, 20, projectId),
    fetchPaidServices(),
    api.top('service_status', range, 20, projectId),
  ]);

  // We don't have a per-service stats endpoint yet; derive sub-tab totals
  // from the recent/top responses since they already carry the data we need.
  const modelsForKey = models.data.items.filter((m) => filterSet.includes(m.service));
  const subCalls = modelsForKey.reduce((s, m) => s + m.count, 0);
  const subCost = modelsForKey.reduce((s, m) => s + (m.cost_usd ?? 0), 0);

  $(ids.cost).textContent = fmtCredits(toCredits(subCost));
  $(ids.calls).textContent = fmtExact(subCalls);
  // The latency endpoint reports total-across-all-services p95. Showing it
  // when this sub-tab has no calls of its own is misleading, so gate on
  // subCalls > 0 — empty sub-tabs read '—' instead of borrowing another
  // service's latency.
  $(ids.p95).textContent = subCalls > 0 ? fmtMs(latency.data.p95) : '—';

  // Error rate from status breakdown, scoped to the filter set.
  const totals = { ok: 0, err: 0 };
  for (const r of statusBreakdown.data.items) {
    if (!filterSet.includes(r.service)) continue;
    if (r.key === 'ok' || r.key === 'success') totals.ok += r.count;
    else totals.err += r.count;
  }
  const total = totals.ok + totals.err;
  $(ids.err).textContent = total > 0 ? fmtPct((totals.err / total) * 100) : '—';

  // Charts: pad to the range. Use the existing /timeseries which is total
  // across all services — for v1 we render the full-services curve; sub-tab-
  // specific timeseries can land in a follow-up if useful.
  const group = groupFor(range);
  const [costTs, callsTs] = await Promise.all([
    api.timeseries('services', range, group, projectId, 'cost_usd'),
    api.timeseries('services', range, group, projectId, 'count'),
  ]);
  const cost = padSeries(costTs.data.series, range, group);
  const calls = padSeries(callsTs.data.series, range, group);
  // Convert the chart's underlying values to credits so the y-axis matches
  // the "Credits used" card label.
  const costInCredits = cost.values.map(toCredits);
  destroy(`${key}Cost`); destroy(`${key}Calls`);
  // eslint-disable-next-line no-undef
  charts[`${key}Cost`] = new Chart($(ids.chartCost), {
    type: 'bar',
    data: { labels: cost.labels, datasets: [{ label: 'Credits', data: costInCredits, backgroundColor: '#fea60b' }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } } } },
  });
  // eslint-disable-next-line no-undef
  charts[`${key}Calls`] = new Chart($(ids.chartCalls), {
    type: 'line',
    data: { labels: calls.labels, datasets: [{ label: 'Calls', data: calls.values, borderColor: '#3498db', backgroundColor: 'rgba(52,152,219,0.1)', fill: true, tension: 0.3, pointRadius: 0 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } } } },
  });

  // Top models (filtered to this sub-tab's service set)
  const modelsBody = $(ids.tableModels)?.querySelector('tbody');
  if (modelsBody) {
    if (!modelsForKey.length) modelsBody.innerHTML = emptyRow(4);
    else modelsBody.innerHTML = modelsForKey.map((m) => `
      <tr>
        <td class="mono">${escapeHtml(m.key)}</td>
        <td class="muted">${escapeHtml(m.service)}</td>
        <td class="num">${fmtNum(m.count)}</td>
        <td class="num">${fmtCredits(toCredits(m.cost_usd ?? 0))}</td>
      </tr>
    `).join('');
  }

  // Top callers (only for paid LLM/Speech sub-tabs that show this panel)
  const callersBody = $(ids.tableCallers)?.querySelector('tbody');
  if (callersBody) {
    if (!callers.data.items.length) callersBody.innerHTML = emptyRow(4, 'No identified end-users yet. Add Sign in with Gipity to your app.');
    else callersBody.innerHTML = callers.data.items.map((c) => `
      <tr>
        <td>${escapeHtml(c.email_local || '—')}</td>
        <td class="mono muted">${escapeHtml(c.key)}</td>
        <td class="num">${fmtNum(c.count)}</td>
        <td class="num">${fmtCredits(toCredits(c.cost_usd ?? 0))}</td>
      </tr>
    `).join('');
  }

  // "By kind" — Media sub-tab only: image vs audio vs video roll-up.
  const kindsBody = $(ids.tableKinds)?.querySelector('tbody');
  if (kindsBody) {
    const byKind = new Map();
    for (const m of modelsForKey) {
      const k = byKind.get(m.service) ?? { calls: 0, cost: 0 };
      k.calls += m.count;
      k.cost += m.cost_usd ?? 0;
      byKind.set(m.service, k);
    }
    if (byKind.size === 0) kindsBody.innerHTML = emptyRow(3);
    else kindsBody.innerHTML = [...byKind.entries()].map(([svc, v]) => `
      <tr>
        <td>${escapeHtml(svc)}</td>
        <td class="num">${fmtNum(v.calls)}</td>
        <td class="num">${fmtCredits(toCredits(v.cost))}</td>
      </tr>
    `).join('');
  }

  // Recent calls
  const recentBody = $(ids.tableRecent)?.querySelector('tbody');
  if (recentBody) {
    if (!recent.data.length) recentBody.innerHTML = emptyRow(5, 'No calls in this window.');
    else {
      const isMedia = filterSet.length > 1;
      recentBody.innerHTML = recent.data.map((c) => `
        <tr>
          <td class="muted">${fmtTime(c.created_at)}</td>
          ${isMedia ? `<td>${escapeHtml(c.service)}</td>` : ''}
          <td class="mono">${escapeHtml(truncate(c.model || '—', 40))}</td>
          <td>${statusPill(c.status)}</td>
          <td class="num muted">${fmtMs(c.latency_ms)}</td>
          <td class="num">${c.cost_usd != null ? fmtCredits(toCredits(c.cost_usd)) : '—'}</td>
        </tr>
      `).join('');
    }
  }

}

export async function renderServicesTab(api, filters) {
  // Wire sub-tab clicks once.
  if (!bound) {
    bound = true;
    document.querySelectorAll('[data-svc-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        showSubTab(btn.dataset.svcTab);
        renderServicesTab(api, filters).catch((err) => console.error('[services] sub-tab render failed', err));
      });
    });
    // Honour deep-link sub-tab on first render.
    currentSub = subFromHash();
    showSubTab(currentSub);
  }

  switch (currentSub) {
    case 'llm':
      return renderPaidSubtab(api, 'llm', ['llm'], filters);
    case 'tts':
      return renderPaidSubtab(api, 'tts', ['tts'], filters);
    case 'media':
      return renderPaidSubtab(api, 'media', ['image', 'audio', 'video'], filters);
    case 'realtime':
      return renderRealtimePanel(api, filters);
    case 'browser':
      return renderCreditSubtab(api, 'browser', { group: 'browser', ids: { cost: 'svc-browser-cost', calls: 'svc-browser-calls', avg: 'svc-browser-avg', chart: 'chart-svc-browser', recent: 'table-svc-browser-recent' } }, filters);
    case 'search':
      return renderCreditSubtab(api, 'search', { group: 'search', ids: { cost: 'svc-search-cost', calls: 'svc-search-calls', fetches: 'svc-search-fetches', chart: 'chart-svc-search', recent: 'table-svc-search-recent' } }, filters);
    default:
      return renderPaidSubtab(api, 'llm', ['llm'], filters);
  }
}

/** Render a credit-ledger-backed sub-tab (Browser / Search). No log_services
 *  rows for these — everything comes from credit_ledger via /credits. */
async function renderCreditSubtab(api, key, { group, ids }, { range, projectId }) {
  const [totals, daily, recent] = await Promise.all([
    api.credits({ range, group }),
    api.credits({ range, group, group_by: 'day' }),
    api.credits({ range, group, limit: 50 }),
  ]);

  // Browser/Search totals come from credit_ledger which already exposes
  // `credits` directly — no toCredits() conversion needed.
  $(ids.cost).textContent = fmtCredits(totals.data.totals.credits);
  $(ids.calls).textContent = fmtExact(totals.data.totals.n);

  if (ids.avg) {
    const avg = totals.data.totals.n > 0 ? totals.data.totals.credits / totals.data.totals.n : 0;
    $(ids.avg).textContent = fmtNum(avg);
  }
  if (ids.fetches) {
    // Search sub-tab: count non-web_search items (twitter / fetch / embedding).
    const nonSearch = recent.data.items.filter((r) => r.operation !== 'web_search').length;
    $(ids.fetches).textContent = fmtExact(nonSearch);
  }

  // Calls-over-time
  const labels = (daily.data.series || []).map(r => new Date(r.bucket).toISOString().slice(0, 10));
  const values = (daily.data.series || []).map(r => r.n);
  destroy(`${key}Chart`);
  // eslint-disable-next-line no-undef
  charts[`${key}Chart`] = new Chart($(ids.chart), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Calls', data: values, backgroundColor: '#3498db' }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } } } },
  });

  // Recent
  const recentBody = $(ids.recent).querySelector('tbody');
  if (!recent.data.items.length) recentBody.innerHTML = emptyRow(4);
  else if (key === 'search') {
    const SEARCH_OP_LABELS = {
      web_search: 'Web search',
      twitter_search: 'Twitter/X',
      web_fetch: 'fetch',
      embedding: 'embedding',
    };
    recentBody.innerHTML = recent.data.items.map((c) => `
      <tr>
        <td class="muted">${fmtTime(c.created_at)}</td>
        <td>${escapeHtml(SEARCH_OP_LABELS[c.operation] || c.operation)}</td>
        <td class="muted">${escapeHtml(c.project_name || c.project_short_guid || '—')}</td>
        <td class="num">${fmtCredits(c.credits_deducted)}</td>
      </tr>
    `).join('');
  } else {
    recentBody.innerHTML = recent.data.items.map((c) => `
      <tr>
        <td class="muted">${fmtTime(c.created_at)}</td>
        <td class="muted">${escapeHtml(c.project_name || c.project_short_guid || '—')}</td>
        <td class="num">${fmtCredits(c.credits_deducted)}</td>
      </tr>
    `).join('');
  }
  void projectId;
}
