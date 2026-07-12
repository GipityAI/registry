/**
 * Usage tab — the master credit_ledger roll-up, expressed in credits.
 * Surfaces every charge across LLM (chat/workflow/memory/app), media, compute,
 * storage, deploys, and agent tools. Most other tabs in Monitor are slices of
 * this same ledger. (Internal tab key remains `spend` so URL hashes and the
 * data-tab attribute don't churn for users who already bookmarked it.)
 */
import { fmtExact, fmtCredits, fmtTime, escapeHtml, emptyRow, toCredits } from '../format.js';
import { chartColor } from '../chart-helpers.js';

let chart = null;
const $ = (id) => document.getElementById(id);

// Display labels for raw operation strings. Anything unmapped renders as-is.
const OP_LABELS = {
  llm_chat: 'LLM (agent chat)',
  llm_workflow: 'LLM (workflow)',
  llm_auto_memory: 'LLM (auto-memory)',
  llm_app_service: 'LLM (app service)',
  tts_stream: 'TTS (stream)',
  tts_batch: 'TTS (batch)',
  tts_app_service: 'TTS (app service)',
  image_gen: 'Image generation',
  image_app_service: 'Image (app service)',
  sound_generate: 'Sound effects',
  music_generate: 'Music',
  sound_app_service: 'Sound (app service)',
  music_app_service: 'Music (app service)',
  video_generate: 'Video generation',
  video_app_service: 'Video (app service)',
  audio_transcribe: 'Audio transcribe',
  transcribe_app_service: 'Transcribe (app service)',
  fn_invocation: 'Function invocation',
  job_compute_cpu_small: 'Job · CPU small',
  job_compute_cpu_medium: 'Job · CPU medium',
  job_compute_cpu_large: 'Job · CPU large',
  job_compute_gpu_small: 'Job · GPU small',
  job_compute_gpu_medium: 'Job · GPU medium',
  job_compute_gpu_large: 'Job · GPU large',
  job_compute_gpu_huge: 'Job · GPU huge',
  sandbox: 'Sandbox',
  browser: 'Browser',
  web_search: 'Web search',
  web_fetch: 'Web fetch',
  storage_daily: 'Storage · Files',
  db_storage_daily: 'Storage · DB',
  deploy: 'Deploy',
  realtime_session: 'Realtime · session',
};

function opLabel(op) {
  return OP_LABELS[op] || op;
}

export async function renderSpendTab(api, { range, projectId }) {
  // All credit queries honor the active project filter (app_guid resolves to
  // project_id server-side). Previously Usage was account-wide regardless of
  // the picker, which the user reported as broken on the Activity / Usage
  // surfaces.
  const filter = projectId ? { app_guid: projectId } : {};
  const [totals, byOp, byProject, daily, recent] = await Promise.all([
    api.credits({ range, ...filter }),
    api.credits({ range, group_by: 'operation', ...filter }),
    api.credits({ range, group_by: 'project', ...filter }),
    api.credits({ range, group_by: 'day', ...filter }),
    api.credits({ range, limit: 100, ...filter }),
  ]);

  // Credits-only display: the user thinks in credits (one consistent unit),
  // not USD. fmtExact (not fmtNum) so big totals don't collapse to "7.0k".
  $('spend-credits').textContent = fmtExact(totals.data.totals.credits);
  $('spend-charges').textContent = fmtExact(totals.data.totals.n);
  $('spend-top-cat').textContent = byOp.data.items[0] ? opLabel(byOp.data.items[0].operation) : '—';

  // Credits over time — derive from `usd` until the endpoint adds a credits
  // series (credits = usd / USD_PER_CREDIT, same rate the top-line cards use).

  const labels = (daily.data.series || []).map((r) => new Date(r.bucket).toISOString().slice(0, 10));
  const values = (daily.data.series || []).map((r) => toCredits(r.usd));
  if (chart) chart.destroy();
  // eslint-disable-next-line no-undef
  chart = new Chart($('chart-spend'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Credits', data: values, backgroundColor: chartColor('primary') }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } } } },
  });

  // By operation
  const opsBody = $('table-spend-ops').querySelector('tbody');
  if (!byOp.data.items.length) opsBody.innerHTML = emptyRow(3, 'No charges in this window.');
  else opsBody.innerHTML = byOp.data.items.map((r) => `
    <tr>
      <td>${escapeHtml(opLabel(r.operation))}</td>
      <td class="num">${fmtExact(r.n)}</td>
      <td class="num">${fmtCredits(toCredits(r.usd))}</td>
    </tr>
  `).join('');

  // By project
  const projBody = $('table-spend-projects').querySelector('tbody');
  if (!byProject.data.items.length) projBody.innerHTML = emptyRow(3);
  else projBody.innerHTML = byProject.data.items.map((r) => `
    <tr>
      <td>${escapeHtml(r.project_name || r.project_short_guid || '—')}</td>
      <td class="num">${fmtExact(r.n)}</td>
      <td class="num">${fmtCredits(toCredits(r.usd))}</td>
    </tr>
  `).join('');

  // Recent charges — show what the user was charged in credits. Never expose
  // credit_ledger.cost_usd (that's our provider cost / margin data).
  const recentBody = $('table-spend-recent').querySelector('tbody');
  if (!recent.data.items.length) recentBody.innerHTML = emptyRow(5);
  else recentBody.innerHTML = recent.data.items.map((c) => `
    <tr>
      <td class="muted">${fmtTime(c.created_at)}</td>
      <td>${escapeHtml(opLabel(c.operation))}</td>
      <td class="mono muted">${escapeHtml(c.model_id || '—')}</td>
      <td class="muted">${escapeHtml(c.project_name || c.project_short_guid || '—')}</td>
      <td class="num">${fmtCredits(c.credits_deducted)}</td>
    </tr>
  `).join('');
}
