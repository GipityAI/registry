import { fmtNum, fmtExact, fmtTime, truncate, escapeHtml, emptyState, padSeries, fmtDelta } from '../format.js';
import { groupFor, barChart } from '../chart-helpers.js';
import { renderTable } from '../ui.js';

let chart = null;
const $ = (id) => document.getElementById(id);
let currentRows = [];

function renderIssuesTable(tbody, rows) {
  // Each issue row is clickable: it jumps to the Activity timeline pre-filtered
  // to this issue's message, where breadcrumbs + network context live.
  renderTable(tbody, rows, (e) => `
    <tr class="row-link" data-goto="activity" data-search="${escapeHtml(truncate(e.message, 60))}">
      <td class="mono" title="${escapeHtml(e.message)}">
        ${escapeHtml(truncate(e.message, 200))}
        ${e.stack ? `<div class="meta">${escapeHtml(truncate(e.stack.split('\n')[1] || e.stack, 200))}</div>` : ''}
      </td>
      <td class="muted">${escapeHtml(e.project_name || e.app_guid || '—')}</td>
      <td class="num">${fmtNum(e.occurrence_count)}</td>
      <td class="muted">${fmtTime(e.last_seen_at)}</td>
    </tr>
  `, { cap: 15, emptyHtml: emptyState(4, {
    icon: '✓',
    message: 'No errors in this window — captured automatically from <code>window.onerror</code> in your deployed apps.',
    tryit: `gipity chat "throw a test error in my app"`,
  }) });
}

export async function renderErrorsTab(api, { range, appGuid, projectId }) {
  const [stats, recent, topErr] = await Promise.all([
    api.stats(range, projectId),
    api.errors(appGuid, undefined, 100),
    api.top('error', range, 50, projectId),
  ]);

  // Hero cards
  const cmp = stats.data.comparison || {};
  $('errors-total').innerHTML = `${fmtExact(stats.data.cards.errors)}${fmtDelta(cmp.errors, 'up_bad')}`;
  $('errors-unique').textContent = fmtExact(topErr.data.items.length);
  const apps = new Set(recent.data.map((r) => r.app_guid).filter(Boolean));
  $('errors-apps').textContent = fmtExact(apps.size);

  // Chart: errors over time, padded across the full range
  const group = groupFor(range);
  const ts = await api.timeseries('errors', range, group, projectId, undefined, 'deploy');
  const { labels, values } = padSeries(ts.data.series, range, group);
  if (chart) chart.destroy();
  chart = barChart($('chart-errors'), { label: 'Errors', labels, values, color: 'error' });
  chart.$annotations = ts.data.annotations || [];
  chart.update();

  // Issues table (dedup'd, sorted by frequency from the list endpoint)
  currentRows = recent.data;
  renderIssuesTable($('table-issues').querySelector('tbody'), currentRows);

  // Wire up search filter once.
  const searchInput = $('errors-search');
  if (!searchInput.dataset.wired) {
    searchInput.dataset.wired = '1';
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      const filtered = q
        ? currentRows.filter((r) => r.message?.toLowerCase().includes(q))
        : currentRows;
      renderIssuesTable($('table-issues').querySelector('tbody'), filtered);
    });
  }
}
