import { fmtNum, fmtExact, truncate, escapeHtml, emptyRow, padSeries, fmtDelta } from '../format.js';
import { groupFor, chartColor, chartFill } from '../chart-helpers.js';

let chart = null;
const $ = (id) => document.getElementById(id);

function renderTable(tbodyEl, rows, mapRow, cols, emptyMsg) {
  if (!rows.length) { tbodyEl.innerHTML = emptyRow(cols, emptyMsg); return; }
  tbodyEl.innerHTML = rows.map(mapRow).join('');
}

export async function renderTrafficTab(api, { range, appGuid, projectId }) {
  // Hero metrics
  const [stats, sessions] = await Promise.all([
    api.stats(range, projectId),
    api.sessions(range, projectId),
  ]);
  const cmp = stats.data.comparison || {};
  $('traffic-pageviews').innerHTML = `${fmtExact(stats.data.cards.traffic)}${fmtDelta(cmp.traffic, 'up_good')}`;
  $('traffic-sessions').textContent = fmtExact(sessions.data.sessions);
  $('traffic-live').textContent = fmtExact(sessions.data.live);

  // Main chart — pad with zero buckets so the X-axis spans the whole window
  // even when most buckets are empty.
  const group = groupFor(range);
  const ts = await api.timeseries('traffic', range, group, projectId, undefined, 'deploy');
  const { labels, values } = padSeries(ts.data.series, range, group);
  const canvas = $('chart-traffic');
  if (chart) chart.destroy();
  // eslint-disable-next-line no-undef
  chart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Page views', data: values, borderColor: chartColor('primary'), backgroundColor: chartFill('primary'), fill: true, tension: 0.3, pointRadius: 0 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } } } },
  });
  chart.$annotations = ts.data.annotations || [];
  chart.update();

  // Tables: top paths, referrers, browsers, devices, languages
  const [paths, referrers, browsers, devices, languages] = await Promise.all([
    api.top('path', range, 10, projectId),
    api.top('referrer', range, 10, projectId),
    api.top('browser', range, 10, projectId),
    api.top('device', range, 10, projectId),
    api.top('language', range, 10, projectId),
  ]);

  $('traffic-distinct-paths').textContent = fmtExact(paths.data.items.length);

  renderTable(
    $('table-paths').querySelector('tbody'),
    paths.data.items,
    (r) => `<tr><td class="mono" title="${escapeHtml(r.key)}">${escapeHtml(truncate(r.key, 60))}</td><td class="num">${fmtNum(r.count)}</td><td class="num muted">${fmtNum(r.sessions)}</td></tr>`,
    3,
  );

  renderTable(
    $('table-referrers').querySelector('tbody'),
    referrers.data.items,
    (r) => `<tr><td class="mono" title="${escapeHtml(r.key)}">${escapeHtml(truncate(r.key, 60))}</td><td class="num">${fmtNum(r.count)}</td></tr>`,
    2,
  );

  renderTable(
    $('table-browsers').querySelector('tbody'),
    browsers.data.items,
    (r) => `<tr><td>${escapeHtml(r.key)}</td><td class="num">${fmtNum(r.count)}</td></tr>`,
    2,
  );

  renderTable(
    $('table-devices').querySelector('tbody'),
    devices.data.items,
    (r) => `<tr><td>${escapeHtml(r.key)}</td><td class="num">${fmtNum(r.count)}</td></tr>`,
    2,
  );

  renderTable(
    $('table-languages').querySelector('tbody'),
    languages.data.items,
    (r) => `<tr><td>${escapeHtml(r.key)}</td><td class="num">${fmtNum(r.count)}</td></tr>`,
    2,
  );

}
