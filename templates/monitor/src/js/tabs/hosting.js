/**
 * Hosting tab — three sub-tabs covering everything about getting your code in
 * front of users:
 *   - Deploys: audit_events filtered by event_type='deploy.*' (chart + table).
 *   - Domains: custom_domains rows + totals.
 *   - CDN:     live size of deployed app bundles served by Gipity CDN.
 *
 * Migrated here from Audit (Deploys) and Data (Domains, CDN) so that
 * "publishing your app" is one umbrella instead of three.
 */
import { fmtNum, fmtExact, fmtBytes, fmtTime, fmtFullTime, escapeHtml, truncate, emptyRow, padSeries } from '../format.js';
import { groupFor, chartColor } from '../chart-helpers.js';
import { requestRender, subTabs } from '../ui.js';

const $ = (id) => document.getElementById(id);
let bound = false;
let currentSub = 'deploys';
let deployChart = null;


const tabs = subTabs('hosting', 'hosting', ['deploys', 'domains', 'cdn']);

function showSubTab(name) {
  currentSub = name;
  tabs.show(name);
}

async function renderDeploysSubtab(api, { range, projectId }) {
  // Source of truth: audit_events filtered server-side by type='deploy'.
  const res = await api.audit('deploy', projectId, 200);

  // Bucket client-side — /timeseries doesn't speak audit_events yet.
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
  if (deployChart) deployChart.destroy();
  // eslint-disable-next-line no-undef
  deployChart = new Chart($('chart-hosting-deploys'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Deploys', data: values, backgroundColor: chartColor('primary') }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } } } },
  });

  const tbody = $('table-hosting-deploys').querySelector('tbody');
  if (!res.data.length) {
    tbody.innerHTML = emptyRow(4, 'No deploys in this window.');
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

async function renderDomainsSubtab(api) {
  const res = await api.domains();
  const t = res.data.totals;
  $('dom-total').textContent = fmtExact(t.total);
  $('dom-active').textContent = fmtExact(t.active);
  $('dom-pending').textContent = fmtExact(t.pending);
  $('dom-failed').textContent = fmtExact(t.failed);

  const body = $('table-domains').querySelector('tbody');
  if (!res.data.domains.length) {
    body.innerHTML = emptyRow(5, 'No custom domains yet — run <code>gipity domain add &lt;domain&gt;</code>.');
    return;
  }
  body.innerHTML = res.data.domains.map((d) => {
    const pill = d.status === 'active' || d.status === 'verified'
      ? `<span class="pill ok">${escapeHtml(d.status)}</span>`
      : d.status === 'pending'
        ? `<span class="pill warn">${escapeHtml(d.status)}</span>`
        : `<span class="pill error">${escapeHtml(d.status)}</span>`;
    return `
    <tr>
      <td class="mono">${escapeHtml(d.domain)}</td>
      <td class="muted">${escapeHtml(d.project_name || d.project_short_guid || '—')}</td>
      <td>${pill}</td>
      <td class="muted">${d.verified_at ? fmtTime(d.verified_at) : '—'}</td>
      <td class="muted">${fmtTime(d.created_at)}</td>
    </tr>
  `;
  }).join('');
}

async function renderCdnSubtab(api, { projectId } = {}) {
  const cdn = await api.dataCdn();
  // The endpoint is an account-wide S3 listing (Redis-cached), but each row
  // carries the project guid — honor the project picker by filtering
  // client-side and recomputing the cards from the filtered rows.
  const projects = projectId
    ? cdn.data.projects.filter((p) => p.project_short_guid === projectId)
    : cdn.data.projects;
  const totalBytes = projectId ? projects.reduce((n, p) => n + p.bytes_total, 0) : cdn.data.total_bytes;
  const totalObjects = projectId ? projects.reduce((n, p) => n + p.objects_total, 0) : cdn.data.object_count;
  $('cdn-size').textContent = fmtBytes(totalBytes);
  $('cdn-objects').textContent = fmtExact(totalObjects);
  $('cdn-projects').textContent = fmtExact(projects.length);

  const body = $('table-cdn-projects').querySelector('tbody');
  if (!projects.length) {
    body.innerHTML = emptyRow(5, 'No apps deployed yet — run <code>gipity deploy dev</code> or <code>gipity deploy prod</code>.');
    return;
  }
  body.innerHTML = projects.map((p) => `
    <tr>
      <td>${escapeHtml(p.project_name || p.project_slug)}</td>
      <td class="num">${fmtBytes(p.bytes_prod)}</td>
      <td class="num">${fmtNum(p.objects_prod)}</td>
      <td class="num muted">${fmtBytes(p.bytes_dev)}</td>
      <td class="num muted">${fmtNum(p.objects_dev)}</td>
    </tr>
  `).join('');
}

export async function renderHostingTab(api, filters) {
  if (!bound) {
    bound = true;
    document.querySelectorAll('[data-hosting-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        showSubTab(btn.dataset.hostingTab);
        // Via the orchestrator: this closure's `filters` are frozen at first bind.
        requestRender();
      });
    });
    currentSub = tabs.fromHash();
    showSubTab(currentSub);
  }
  switch (currentSub) {
    case 'deploys': return renderDeploysSubtab(api, filters);
    case 'domains': return renderDomainsSubtab(api);
    case 'cdn':     return renderCdnSubtab(api, filters);
    default:        return renderDeploysSubtab(api, filters);
  }
}
