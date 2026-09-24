/**
 * Compute tab: five sub-tabs. Functions (fast serverless), Jobs (CPU/GPU
 * compute), Sandbox (agent code runs), Workflows (multi-step pipelines) and
 * Tests (`gipity test` runs). Each is backed by a different log source; job,
 * workflow and test rows open a detail dialog.
 */
import { renderFunctionsTab } from './functions.js';
import { fmtNum, fmtExact, fmtCredits, fmtMs, fmtTime, escapeHtml, statusPill, emptyRow, emptyState, padSeries } from '../format.js';
import { groupFor, lineChart } from '../chart-helpers.js';
import { requestRender, subTabs, hashPath } from '../ui.js';
import { openDetailAsync, jsonBlock } from '../detail.js';

const $ = (id) => document.getElementById(id);
let bound = false;
let currentSub = 'functions';
let sandboxChart = null;

const tabs = subTabs('compute', 'cmp', ['functions', 'jobs', 'sandbox', 'workflows', 'tests']);

function showSubTab(name) {
  currentSub = name;
  tabs.show(name);
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
      <td class="muted">${escapeHtml(j.compute || '-')}</td>
      <td class="num">${fmtNum(j.runs)}</td>
      <td class="num">${j.failures > 0 ? `<span class="pill error">${fmtNum(j.failures)}</span>` : '<span class="muted">0</span>'}</td>
      <td class="num muted">${fmtMs(j.avg_ms)}</td>
    </tr>
  `).join('');

  const recentBody = $('table-jobs-recent').querySelector('tbody');
  if (!res.data.recent.length) recentBody.innerHTML = emptyRow(5);
  else recentBody.innerHTML = res.data.recent.map((r) => `
    <tr class="clickable-row" data-job-run="${escapeHtml(r.short_guid)}" data-project="${escapeHtml(r.project_short_guid || '')}" title="Show output and logs">
      <td class="muted">${fmtTime(r.created_at)}</td>
      <td class="mono">${escapeHtml(r.name)}</td>
      <td class="muted">${escapeHtml(r.compute || '-')}</td>
      <td>${statusPill(r.status)}</td>
      <td class="num muted">${fmtMs(r.duration_ms)}</td>
    </tr>
  `).join('');
}

/** A job run: status, error, output, input and the rolling log tail. */
function showJobRun(api, projectGuid, runGuid) {
  openDetailAsync(`Job run ${runGuid}`, async () => {
    const r = (await api.jobRun(projectGuid, runGuid)).data;
    const html = `
      <div class="detail-meta">
        <span>${statusPill(r.status)}</span>
        <span>Started ${fmtTime(r.started_at || r.created_at)}</span>
        <span>Duration ${fmtMs(r.duration_ms)}</span>
        ${r.attempt > 1 ? `<span>Attempt ${fmtNum(r.attempt)}</span>` : ''}
        ${r.progress_message ? `<span>${escapeHtml(r.progress_message)}</span>` : ''}
      </div>
      ${r.error ? `<h4>Error</h4><pre class="detail-pre detail-error">${escapeHtml(r.error)}</pre>` : ''}
      <h4>Output</h4>${jsonBlock(r.output)}
      <h4>Input</h4>${jsonBlock(r.input)}
      <h4>Log tail</h4>${r.log_tail ? `<pre class="detail-pre">${escapeHtml(r.log_tail)}</pre>` : '<p class="muted">No log output captured.</p>'}
      <p class="muted small">CLI: <code>gipity job logs ${escapeHtml(runGuid)}</code></p>`;
    return { html };
  });
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
  sandboxChart = lineChart($('chart-sandbox'), { label: 'Executions', labels: padded.labels, values: padded.values, color: 'info' });

  const recentBody = $('table-sandbox-recent').querySelector('tbody');
  if (!recent.data.items.length) recentBody.innerHTML = emptyRow(3, 'No sandbox executions in this window.');
  else recentBody.innerHTML = recent.data.items.map((c) => `
    <tr>
      <td class="muted">${fmtTime(c.created_at)}</td>
      <td class="muted">${escapeHtml(c.project_name || c.project_short_guid || '-')}</td>
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
      <td class="muted">${w.last_run_at ? fmtTime(w.last_run_at) : '-'}</td>
    </tr>
  `).join('');

  const recentBody = $('table-workflows-recent').querySelector('tbody');
  if (!res.data.recent.length) recentBody.innerHTML = emptyRow(5, 'No workflow runs in this window.');
  else recentBody.innerHTML = res.data.recent.map((r) => `
    <tr class="clickable-row" data-wf-run="${escapeHtml(r.short_guid)}" data-workflow="${escapeHtml(r.workflow_guid)}" title="Show each step's output">
      <td class="muted">${fmtTime(r.started_at)}</td>
      <td class="mono">${escapeHtml(r.name)}</td>
      <td class="muted">${escapeHtml(r.trigger_type)}</td>
      <td>${statusPill(r.status)}</td>
      <td class="num muted">${fmtMs(r.duration_ms)}</td>
    </tr>
  `).join('');
}

/** A workflow run: every step's status, JSON output and error, in order. */
function showWorkflowRun(api, workflowGuid, runGuid) {
  openDetailAsync(`Workflow run ${runGuid}`, async () => {
    const r = (await api.workflowRun(workflowGuid, runGuid)).data;
    const tokens = (r.total_input_tokens || 0) + (r.total_output_tokens || 0);
    const steps = (r.step_runs || []).map((st) => `
      <div class="detail-step">
        <div class="detail-step-head">
          <span class="muted">${fmtNum(st.step_order)}.</span>
          <span class="mono">${escapeHtml(st.step_name || '(deleted step)')}</span>
          ${statusPill(st.status)}
          ${st.model_used ? `<span class="muted small">${escapeHtml(st.model_used)}</span>` : ''}
          ${st.tokens_used ? `<span class="muted small">${fmtNum(st.tokens_used)} tokens</span>` : ''}
        </div>
        ${st.error_message ? `<pre class="detail-pre detail-error">${escapeHtml(st.error_message)}</pre>` : ''}
        ${st.output_json != null ? jsonBlock(st.output_json) : ''}
        ${st.human_action ? `<p class="small">Human: <b>${escapeHtml(st.human_action)}</b>${st.human_response ? ` - ${escapeHtml(st.human_response)}` : ''}</p>` : ''}
        ${st.input_text ? `<details><summary class="small muted">Prompt</summary><pre class="detail-pre">${escapeHtml(st.input_text)}</pre></details>` : ''}
      </div>`).join('');
    const html = `
      <div class="detail-meta">
        <span class="mono">${escapeHtml(r.workflow_name || workflowGuid)}</span>
        <span>${statusPill(r.status)}</span>
        <span>${escapeHtml(r.trigger_type)}</span>
        <span>Started ${fmtTime(r.started_at)}</span>
        ${tokens ? `<span>${fmtNum(tokens)} tokens</span>` : ''}
      </div>
      ${r.error_message ? `<pre class="detail-pre detail-error">${escapeHtml(r.error_message)}</pre>` : ''}
      ${steps || '<p class="muted">No steps ran.</p>'}
      <p class="muted small">CLI: <code>gipity workflow runs ${escapeHtml(/\s/.test(r.workflow_name) ? `"${r.workflow_name}"` : r.workflow_name)} ${escapeHtml(runGuid)}</code></p>`;
    return { html };
  });
}

async function renderTestsSubtab(api, { range, projectId }) {
  const res = await api.tests(range, projectId);
  const s = res.data.summary;
  $('tests-runs').textContent = fmtExact(s.runs);
  $('tests-failed-runs').innerHTML = s.failed_runs > 0 ? `<span class="pill error">${fmtExact(s.failed_runs)}</span>` : '0';
  $('tests-count').textContent = fmtExact(s.tests);
  $('tests-failed').textContent = fmtExact(s.failed_tests);

  const body = $('table-tests-recent').querySelector('tbody');
  if (!res.data.recent.length) {
    body.innerHTML = emptyState(6, { icon: '✓', message: 'No test runs in this window.', tryit: 'gipity test' });
    return;
  }
  body.innerHTML = res.data.recent.map((t) => `
    <tr class="clickable-row" data-test-run="${escapeHtml(t.run_guid)}" data-project="${escapeHtml(t.project_short_guid)}" title="Show each test's result">
      <td class="muted">${fmtTime(t.started_at)}</td>
      <td>${escapeHtml(t.project_name)}${t.filter_path ? ` <span class="muted mono small">${escapeHtml(t.filter_path)}</span>` : ''}</td>
      <td>${statusPill(t.status)}</td>
      <td class="num">${fmtNum(t.passed)} / ${fmtNum(t.total)}</td>
      <td class="num">${t.failed > 0 ? `<span class="pill error">${fmtNum(t.failed)}</span>` : '<span class="muted">0</span>'}</td>
      <td class="num muted">${fmtMs(t.duration_ms)}</td>
    </tr>
  `).join('');
}

/** A test run: failures first, each with its error and captured output. */
function showTestRun(api, projectGuid, runGuid) {
  openDetailAsync(`Test run ${runGuid}`, async () => {
    const r = (await api.testRun(projectGuid, runGuid)).data;
    const order = { failed: 0, skipped: 1, passed: 2 };
    const results = [...(r.results || [])].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
    const rows = results.map((t) => `
      <div class="detail-step">
        <div class="detail-step-head">
          ${statusPill(t.status)}
          <span class="mono">${escapeHtml(t.name)}</span>
          <span class="muted small">${escapeHtml(t.path)}</span>
          ${t.isFlaky ? '<span class="pill warn">flaky</span>' : ''}
          <span class="muted small">${fmtMs(t.durationMs)}</span>
        </div>
        ${t.error ? `<pre class="detail-pre detail-error">${escapeHtml(t.error)}</pre>` : ''}
        ${t.output ? `<details><summary class="small muted">Output</summary><pre class="detail-pre">${escapeHtml(t.output)}</pre></details>` : ''}
      </div>`).join('');
    const html = `
      <div class="detail-meta">
        <span>${statusPill(r.status)}</span>
        <span>${fmtNum(r.passed)} passed, ${fmtNum(r.failed)} failed, ${fmtNum(r.skipped)} skipped</span>
        <span>Started ${fmtTime(r.startedAt)}</span>
        <span>${fmtMs(r.durationMs)}</span>
      </div>
      ${r.errorMessage ? `<pre class="detail-pre detail-error">${escapeHtml(r.errorMessage)}</pre>` : ''}
      ${r.dbSummary ? `<p class="muted small">${escapeHtml(r.dbSummary)}</p>` : ''}
      ${rows || '<p class="muted">No test results recorded.</p>'}`;
    return { html };
  });
}

export async function renderComputeTab(api, filters) {
  if (!bound) {
    bound = true;
    // Row clicks open detail; delegated so re-rendered tables stay wired.
    $('table-jobs-recent').addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-job-run]');
      if (tr && tr.dataset.project) showJobRun(api, tr.dataset.project, tr.dataset.jobRun);
    });
    $('table-workflows-recent').addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-wf-run]');
      if (tr) showWorkflowRun(api, tr.dataset.workflow, tr.dataset.wfRun);
    });
    $('table-tests-recent').addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-test-run]');
      if (tr) showTestRun(api, tr.dataset.project, tr.dataset.testRun);
    });
    document.querySelectorAll('[data-cmp-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        showSubTab(btn.dataset.cmpTab);
        // Via the orchestrator: this closure's `filters` are frozen at first bind.
        requestRender();
      });
    });
  }
  // Re-read the sub-tab from the hash on every render (not just first bind)
  // so cross-tab links (e.g. Overview → compute/jobs) land on the right sub view.
  if (hashPath().split('/')[0] === 'compute') showSubTab(tabs.fromHash());
  switch (currentSub) {
    case 'functions':
      return renderFunctionsTab(api, filters);
    case 'jobs':
      return renderJobsSubtab(api, filters);
    case 'sandbox':
      return renderSandboxSubtab(api, filters);
    case 'workflows':
      return renderWorkflowsSubtab(api, filters);
    case 'tests':
      return renderTestsSubtab(api, filters);
    default:
      return renderFunctionsTab(api, filters);
  }
}
