/**
 * Compute tab — four sub-tabs: Functions (fast serverless), Jobs (CPU/GPU
 * compute), Sandbox (agent code runs), Workflows (multi-step LLM pipelines).
 * Each is backed by a different log source but shares the credit_ledger as
 * billing truth.
 */
import { renderFunctionsTab } from './functions.js';
import { fmtNum, fmtExact, fmtCredits, fmtMs, fmtTime, escapeHtml, statusPill, emptyRow, padSeries } from '../format.js';
import { groupFor, chartColor, chartFill } from '../chart-helpers.js';
import { requestRender } from '../ui.js';

const $ = (id) => document.getElementById(id);
let bound = false;
let currentSub = 'functions';
let sandboxChart = null;

function subFromHash() {
  const after = location.hash.slice(1).split('/')[1];
  return ['functions', 'jobs', 'sandbox', 'workflows'].includes(after) ? after : 'functions';
}

function showSubTab(name) {
  currentSub = name;
  document.querySelectorAll('[data-cmp-tab]').forEach((b) => b.classList.toggle('active', b.dataset.cmpTab === name));
  document.querySelectorAll('[data-cmp-panel]').forEach((p) => { p.hidden = p.dataset.cmpPanel !== name; });
  if (location.hash.slice(1).split('/')[0] === 'compute') location.hash = `compute/${name}`;
}

async function renderJobsSubtab(api, { range, projectId }) {
  const res = await api.jobs(range, projectId);
  const s = res.data.summary;
  $('job-runs').textContent = fmtExact(s.runs);
  $('job-failures').textContent = fmtExact(s.failures);
  $('job-avg').textContent = fmtMs(s.avg_ms);
  $('job-p95').textContent = fmtMs(s.p95_ms);

  const topBody = $('table-jobs-top').querySelector('tbody');
  if (!res.data.top.length) topBody.innerHTML = emptyRow(5, 'No jobs in this window.');
  else topBody.innerHTML = res.data.top.map((j) => `
    <tr>
      <td class="mono">${escapeHtml(j.name)}</td>
      <td class="muted">${escapeHtml(j.compute || '—')}</td>
      <td class="num">${fmtNum(j.runs)}</td>
      <td class="num">${j.failures > 0 ? `<span class="pill error">${fmtNum(j.failures)}</span>` : '<span class="muted">0</span>'}</td>
      <td class="num muted">${fmtMs(j.avg_ms)}</td>
    </tr>
  `).join('');

  const recentBody = $('table-jobs-recent').querySelector('tbody');
  if (!res.data.recent.length) recentBody.innerHTML = emptyRow(5);
  else recentBody.innerHTML = res.data.recent.map((r) => `
    <tr>
      <td class="muted">${fmtTime(r.created_at)}</td>
      <td class="mono">${escapeHtml(r.name)}</td>
      <td class="muted">${escapeHtml(r.compute || '—')}</td>
      <td>${statusPill(r.status)}</td>
      <td class="num muted">${fmtMs(r.duration_ms)}</td>
    </tr>
  `).join('');
}

async function renderSandboxSubtab(api, { range, projectId }) {
  // Wire projectId through to all three credit calls (was only on `recent`).
  const filter = projectId ? { app_guid: projectId } : {};
  const [totals, daily, recent] = await Promise.all([
    api.credits({ range, group: 'sandbox', ...filter }),
    api.credits({ range, group: 'sandbox', group_by: 'day', ...filter }),
    api.credits({ range, group: 'sandbox', limit: 50, ...filter }),
  ]);

  $('sbx-cost').textContent = fmtCredits(totals.data.totals.credits);
  $('sbx-calls').textContent = fmtExact(totals.data.totals.n);

  const group = groupFor(range);
  const padded = padSeries((daily.data.series || []).map(r => ({ bucket: r.bucket, value: r.n })), range, group);
  if (sandboxChart) sandboxChart.destroy();
  // eslint-disable-next-line no-undef
  sandboxChart = new Chart($('chart-sandbox'), {
    type: 'line',
    data: { labels: padded.labels, datasets: [{ label: 'Executions', data: padded.values, borderColor: chartColor('info'), backgroundColor: chartFill('info'), fill: true, tension: 0.3, pointRadius: 0 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } } } },
  });

  const recentBody = $('table-sandbox-recent').querySelector('tbody');
  if (!recent.data.items.length) recentBody.innerHTML = emptyRow(3, 'No sandbox executions in this window.');
  else recentBody.innerHTML = recent.data.items.map((c) => `
    <tr>
      <td class="muted">${fmtTime(c.created_at)}</td>
      <td class="muted">${escapeHtml(c.project_name || c.project_short_guid || '—')}</td>
      <td class="num">${fmtCredits(c.credits_deducted)}</td>
    </tr>
  `).join('');
}

async function renderWorkflowsSubtab(api, { range, projectId }) {
  const res = await api.workflows(range, projectId);
  const s = res.data.summary;
  $('wf-active').textContent = fmtExact(s.active);
  $('wf-runs').textContent = fmtExact(s.runs);
  $('wf-failures').innerHTML = s.failures > 0
    ? `<span class="pill error">${fmtExact(s.failures)}</span>`
    : '0';
  $('wf-avg').textContent = fmtMs(s.avg_ms);

  const topBody = $('table-workflows-top').querySelector('tbody');
  if (!res.data.top.length) topBody.innerHTML = emptyRow(6, 'No workflows defined yet.');
  else topBody.innerHTML = res.data.top.map((w) => `
    <tr>
      <td class="mono">${escapeHtml(w.name)}</td>
      <td class="muted">${escapeHtml(w.trigger_type)}${w.cron_expression ? ` <code>${escapeHtml(w.cron_expression)}</code>` : ''}</td>
      <td>${w.is_active ? '<span class="pill ok">on</span>' : '<span class="pill muted">off</span>'}</td>
      <td class="num">${fmtNum(w.runs)}</td>
      <td class="num">${w.failures > 0 ? `<span class="pill error">${fmtNum(w.failures)}</span>` : '<span class="muted">0</span>'}</td>
      <td class="muted">${w.last_run_at ? fmtTime(w.last_run_at) : '—'}</td>
    </tr>
  `).join('');

  const recentBody = $('table-workflows-recent').querySelector('tbody');
  if (!res.data.recent.length) recentBody.innerHTML = emptyRow(5, 'No workflow runs in this window.');
  else recentBody.innerHTML = res.data.recent.map((r) => `
    <tr>
      <td class="muted">${fmtTime(r.started_at)}</td>
      <td class="mono">${escapeHtml(r.name)}</td>
      <td class="muted">${escapeHtml(r.trigger_type)}</td>
      <td>${statusPill(r.status)}</td>
      <td class="num muted">${fmtMs(r.duration_ms)}</td>
    </tr>
  `).join('');
}

export async function renderComputeTab(api, filters) {
  if (!bound) {
    bound = true;
    document.querySelectorAll('[data-cmp-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        showSubTab(btn.dataset.cmpTab);
        // Via the orchestrator: this closure's `filters` are frozen at first bind.
        requestRender();
      });
    });
    currentSub = subFromHash();
    showSubTab(currentSub);
  }
  switch (currentSub) {
    case 'functions':
      return renderFunctionsTab(api, filters);
    case 'jobs':
      return renderJobsSubtab(api, filters);
    case 'sandbox':
      return renderSandboxSubtab(api, filters);
    case 'workflows':
      return renderWorkflowsSubtab(api, filters);
    default:
      return renderFunctionsTab(api, filters);
  }
}
