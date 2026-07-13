import { fmtNum, fmtExact, truncate, escapeHtml, emptyRow, emptyState, padSeries, fmtDelta } from '../format.js';
import { groupFor, lineChart } from '../chart-helpers.js';
import { renderTable } from '../ui.js';

let chart = null;
const $ = (id) => document.getElementById(id);

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
  if (chart) chart.destroy();
  chart = lineChart($('chart-traffic'), { label: 'Page views', labels, values, color: 'primary' });
  chart.$annotations = ts.data.annotations || [];
  chart.update();

  // Tables: fetch 50, show 10 + "Show more" so the lists aren't dead ends.
  const [paths, referrers, browsers, devices, languages] = await Promise.all([
    api.top('path', range, 50, projectId),
    api.top('referrer', range, 50, projectId),
    api.top('browser', range, 50, projectId),
    api.top('device', range, 50, projectId),
    api.top('language', range, 50, projectId),
  ]);

  $('traffic-distinct-paths').textContent = fmtExact(paths.data.items.length);

  renderTable(
    $('table-paths').querySelector('tbody'),
    paths.data.items,
    (r) => `<tr><td class="mono" title="${escapeHtml(r.key)}">${escapeHtml(truncate(r.key, 60))}</td><td class="num">${fmtNum(r.count)}</td><td class="num muted">${fmtNum(r.sessions)}</td></tr>`,
    { emptyHtml: emptyState(3, {
      icon: '👁',
      message: 'Page views from your deployed apps will appear here — the analytics script ships with every Gipity template.',
      tryit: 'gipity deploy dev',
    }) },
  );

  renderTable(
    $('table-referrers').querySelector('tbody'),
    referrers.data.items,
    (r) => `<tr><td class="mono" title="${escapeHtml(r.key)}">${escapeHtml(truncate(r.key, 60))}</td><td class="num">${fmtNum(r.count)}</td></tr>`,
    { emptyHtml: emptyRow(2) },
  );

  renderTable(
    $('table-browsers').querySelector('tbody'),
    browsers.data.items,
    (r) => `<tr><td>${escapeHtml(r.key)}</td><td class="num">${fmtNum(r.count)}</td></tr>`,
    { emptyHtml: emptyRow(2) },
  );

  renderTable(
    $('table-devices').querySelector('tbody'),
    devices.data.items,
    (r) => `<tr><td>${escapeHtml(r.key)}</td><td class="num">${fmtNum(r.count)}</td></tr>`,
    { emptyHtml: emptyRow(2) },
  );

  renderTable(
    $('table-languages').querySelector('tbody'),
    languages.data.items,
    (r) => `<tr><td>${escapeHtml(r.key)}</td><td class="num">${fmtNum(r.count)}</td></tr>`,
    { emptyHtml: emptyRow(2) },
  );
}
