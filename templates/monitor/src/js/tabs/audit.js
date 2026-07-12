import { fmtTime, fmtFullTime, escapeHtml, truncate, emptyRow, padSeries } from '../format.js';
import { groupFor, chartColor } from '../chart-helpers.js';

let chart = null;
const $ = (id) => document.getElementById(id);

export async function renderAuditTab(api, { range, projectId, type }) {
  const res = await api.audit(type, projectId, 200);

  // Bucket events client-side (no /timeseries support for audit_events yet),
  // then pad with zero buckets so the X-axis spans the whole range.
  const group = groupFor(range);
  const counts = new Map();
  for (const e of res.data) {
    const k = new Date(e.created_at);
    if (group === 'minute') k.setSeconds(0, 0);
    else if (group === 'hour') k.setMinutes(0, 0, 0);
    else k.setHours(0, 0, 0, 0);
    const key = k.getTime();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const series = Array.from(counts.entries()).map(([t, v]) => ({ bucket: new Date(t), value: v }));
  const { labels, values } = padSeries(series, range, group);
  if (chart) chart.destroy();
  // eslint-disable-next-line no-undef
  chart = new Chart($('chart-audit'), {
    type: 'bar',
    data: { labels, datasets: [{ label: type, data: values, backgroundColor: chartColor('info') }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } } } },
  });

  const tbody = $('table-audit').querySelector('tbody');
  if (!res.data.length) {
    tbody.innerHTML = emptyRow(4, `No ${type} events in this window.`);
    return;
  }
  tbody.innerHTML = res.data.map((e) => {
    const detail = e.detail ? Object.entries(e.detail).slice(0, 3).map(([k, v]) => `${k}=${escapeHtml(typeof v === 'string' ? v : JSON.stringify(v))}`).join(' · ') : '';
    return `
      <tr>
        <td class="muted" title="${fmtFullTime(e.created_at)}">${fmtTime(e.created_at)}</td>
        <td>${escapeHtml(e.event_type)}</td>
        <td class="muted">${escapeHtml(truncate(detail, 120))}</td>
        <td class="mono muted">${escapeHtml(e.ip_address || '—')}</td>
      </tr>
    `;
  }).join('');
}
