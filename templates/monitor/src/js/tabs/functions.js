import { fmtNum, fmtExact, fmtMs, fmtPct, fmtTime, escapeHtml, statusPill, truncate, emptyRow, padSeries, fmtDelta } from '../format.js';
import { groupFor } from '../chart-helpers.js';

let chart = null;
const $ = (id) => document.getElementById(id);

export async function renderFunctionsTab(api, { range, appGuid, projectId }) {
  const [stats, latency, fnTop, recent] = await Promise.all([
    api.stats(range, projectId),
    api.latency('functions', range, projectId),
    api.top('function', range, 20, projectId),
    api.functions(appGuid, 50),
  ]);

  const cmp = stats.data.comparison || {};
  $('fn-invocations').innerHTML = `${fmtExact(stats.data.cards.functions)}${fmtDelta(cmp.functions, 'up_good')}`;
  $('fn-p95').textContent = fmtMs(latency.data.p95);

  // Error rate from function rows in the top list.
  let totalCalls = 0; let totalErrs = 0;
  for (const f of fnTop.data.items) { totalCalls += f.count; totalErrs += (f.error_count || 0); }
  $('fn-err-rate').textContent = totalCalls > 0 ? fmtPct((totalErrs / totalCalls) * 100) : '—';

  // Chart — pad to full range
  const group = groupFor(range);
  const ts = await api.timeseries('functions', range, group, projectId, undefined, 'deploy');
  const { labels, values } = padSeries(ts.data.series, range, group);
  if (chart) chart.destroy();
  // eslint-disable-next-line no-undef
  chart = new Chart($('chart-functions'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Invocations', data: values, borderColor: '#9b59b6', backgroundColor: 'rgba(155,89,182,0.1)', fill: true, tension: 0.3, pointRadius: 0 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } } } },
  });
  chart.$annotations = ts.data.annotations || [];
  chart.update();

  // Functions summary table
  const fnBody = $('table-functions').querySelector('tbody');
  if (!fnTop.data.items.length) fnBody.innerHTML = emptyRow(5, 'No function invocations in this window.');
  else fnBody.innerHTML = fnTop.data.items.map((f) => `
    <tr>
      <td class="mono">${escapeHtml(f.key)}</td>
      <td class="muted">${escapeHtml(f.project_name || '—')}</td>
      <td class="num">${fmtNum(f.count)}</td>
      <td class="num muted">${fmtMs(f.avg_duration_ms)}</td>
      <td class="num">${f.error_count > 0 ? `<span class="pill pill-error">${fmtNum(f.error_count)}</span>` : '<span class="muted">0</span>'}</td>
    </tr>
  `).join('');

  // Recent invocations table
  const recBody = $('table-fn-recent').querySelector('tbody');
  if (!recent.data.length) recBody.innerHTML = emptyRow(4);
  else recBody.innerHTML = recent.data.map((r) => `
    <tr>
      <td class="muted">${fmtTime(r.created_at)}</td>
      <td class="mono">${escapeHtml(truncate(r.function_name || 'unknown', 40))}</td>
      <td>${statusPill(r.status)}</td>
      <td class="num muted">${fmtMs(r.duration_ms)}</td>
    </tr>
  `).join('');
}
