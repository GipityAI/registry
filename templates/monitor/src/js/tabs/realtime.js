/**
 * Realtime panel — rendered inside the Services tab's Realtime sub-tab.
 * Pulls live CCU + room count from the realtime matchmaker (via
 * /account/logs/realtime/live) and aggregated session metrics from
 * log_services where service='realtime'.
 */
import { fmtNum, fmtExact, fmtMs, fmtTime, escapeHtml, emptyRow, padSeries, truncate } from '../format.js';
import { groupFor, chartColor, chartFill } from '../chart-helpers.js';

let ccuChart = null;
let sessionsChart = null;
const $ = (id) => document.getElementById(id);

function fmtDurationCard(ms) {
  if (!ms) return '—';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export async function renderRealtimePanel(api, { range, projectId }) {
  const [live, summary, callsTs] = await Promise.all([
    api.realtimeLive().catch((err) => {
      if (err.message === 'UNAUTHENTICATED') throw err;
      return { data: { live_ccu: 0, rooms: 0, by_project: [], degraded: err.message } };
    }),
    api.realtimeSummary(range, projectId),
    api.timeseries('services', range, groupFor(range), projectId, 'count'),
  ]);

  $('rt-live').textContent = fmtExact(live.data.live_ccu);
  $('rt-sessions').textContent = fmtExact(summary.data.sessions);
  $('rt-avg-duration').textContent = fmtDurationCard(summary.data.avg_duration_ms);
  $('rt-ccu-min').textContent = fmtExact(Math.round(summary.data.ccu_minutes));

  // Pull a realtime-only timeseries via /services with the same range/group.
  // For v1 we re-use the existing services endpoint and rely on its 'count'
  // metric — refine to per-service filter once we add it. For now this shows
  // total service activity which may include LLM/etc.
  const group = groupFor(range);
  const { labels, values } = padSeries(callsTs.data.series, range, group);

  // Approximate CCU-min over time from sessions × avg duration; precise enough
  // for an at-a-glance view. For v2 add a dedicated /realtime/timeseries.
  const ccuMinSeries = values.map(v => +(v * (summary.data.avg_duration_ms / 60_000)).toFixed(2));

  if (ccuChart) ccuChart.destroy();
  if (sessionsChart) sessionsChart.destroy();
  // eslint-disable-next-line no-undef
  ccuChart = new Chart($('chart-realtime-ccu'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'CCU-min', data: ccuMinSeries, borderColor: chartColor('primary'), backgroundColor: chartFill('primary'), fill: true, tension: 0.3, pointRadius: 0 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } } } },
  });
  // eslint-disable-next-line no-undef
  sessionsChart = new Chart($('chart-realtime-sessions'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Sessions', data: values, backgroundColor: chartColor('info') }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } } } },
  });

  // Top apps by CCU-min (from log_services aggregation)
  const appsBody = $('table-rt-apps').querySelector('tbody');
  if (!summary.data.top_apps.length) appsBody.innerHTML = emptyRow(3, 'No realtime sessions in this window.');
  else appsBody.innerHTML = summary.data.top_apps.map((a) => `
    <tr>
      <td>${escapeHtml(a.project_name || a.project_short_guid || '—')}</td>
      <td class="num">${fmtNum(a.sessions)}</td>
      <td class="num">${fmtNum(Math.round(a.ccu_min))}</td>
    </tr>
  `).join('');

  // Active rooms now (live from matchMaker)
  const roomsBody = $('table-rt-rooms').querySelector('tbody');
  if (live.data.degraded) {
    roomsBody.innerHTML = emptyRow(3, `Realtime service unreachable: ${live.data.degraded}`);
  } else if (!live.data.by_project?.length) {
    roomsBody.innerHTML = emptyRow(3, 'No live rooms right now.');
  } else {
    roomsBody.innerHTML = live.data.by_project.map((p) => `
      <tr>
        <td>${escapeHtml(p.project_name || p.project_guid)}</td>
        <td class="num">${fmtNum(p.rooms)}</td>
        <td class="num">${fmtNum(p.clients)}</td>
      </tr>
    `).join('');
  }

  // Recent sessions — list endpoint scoped to service='realtime', following
  // the project picker (projectId is the picker's short_guid → app_guid).
  const recentRes = await api.services(projectId, 'realtime', 30).catch(() => ({ data: [] }));
  const recentBody = $('table-rt-recent').querySelector('tbody');
  if (!recentRes.data.length) {
    recentBody.innerHTML = emptyRow(4, 'No recent sessions.');
  } else {
    recentBody.innerHTML = recentRes.data.map((c) => `
      <tr>
        <td class="muted">${fmtTime(c.created_at)}</td>
        <td>${escapeHtml(truncate(c.project_name || c.app_guid || '—', 28))}</td>
        <td class="muted mono">${c.caller_user_id ? `user ${c.caller_user_id}` : 'anon'}</td>
        <td class="num">${fmtMs(c.latency_ms)}</td>
      </tr>
    `).join('');
  }
}
