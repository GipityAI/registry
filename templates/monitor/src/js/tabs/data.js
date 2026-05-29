/**
 * Data tab — two sub-tabs covering persistent storage:
 *   - Files: total bytes (live count) + per-project breakdown + storage cost chart.
 *   - DB:    Per-project Postgres schema bytes (live from userdata cluster) +
 *            table counts + recent db_storage_daily charges.
 *
 * CDN + Domains used to live here too but moved to the Hosting tab — they're
 * about delivery, not persistence.
 */
import { fmtNum, fmtExact, fmtCredits, escapeHtml, emptyRow } from '../format.js';

// Same conversion the Usage tab uses — keeps the dashboard in one consistent
// unit (credits) instead of mixing USD and credit cards.
const USD_PER_CREDIT = 0.001;
const toCredits = (usd) => Number(usd) / USD_PER_CREDIT;

/**
 * Roll up multiple per-reading ledger rows into one entry per UTC day.
 * The storage meter now records actual elapsed time per run (see
 * storage-meter.ts), so a day can have several rows when the cron retries or
 * frequency changes. Users want to see "what did today cost?", not "what did
 * each reading cost?" - so we sum credits per day for the table.
 */
function aggregateByDay(items) {
  const byDay = new Map();
  for (const c of items) {
    const day = new Date(c.created_at).toISOString().slice(0, 10);
    const acc = byDay.get(day) ?? { day, credits: 0, rows: 0 };
    acc.credits += Number(c.credits_deducted);
    acc.rows += 1;
    byDay.set(day, acc);
  }
  return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
}

let costChart = null;
const $ = (id) => document.getElementById(id);
let bound = false;
let currentSub = 'files';

function fmtBytes(n) {
  if (n == null || isNaN(n)) return '—';
  const KB = 1024, MB = KB * 1024, GB = MB * 1024;
  if (n >= GB) return (n / GB).toFixed(2) + ' GB';
  if (n >= MB) return (n / MB).toFixed(2) + ' MB';
  if (n >= KB) return (n / KB).toFixed(1) + ' KB';
  return `${n} B`;
}

function subFromHash() {
  const after = location.hash.slice(1).split('/')[1];
  return ['files', 'db'].includes(after) ? after : 'files';
}

function showSubTab(name) {
  currentSub = name;
  document.querySelectorAll('[data-data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.dataTab === name));
  document.querySelectorAll('[data-data-panel]').forEach((p) => { p.hidden = p.dataset.dataPanel !== name; });
  if (location.hash.slice(1).split('/')[0] === 'data') location.hash = `data/${name}`;
}

async function renderFilesSubtab(api, { range, projectId }) {
  // All credit queries follow the range + project filters so card / chart /
  // table all describe the same window for the same scope. (Previously this
  // was hard-coded to 30d and account-wide regardless of the picker.)
  const filter = projectId ? { app_guid: projectId } : {};
  const [live, ledger, costSeries, recentCharges] = await Promise.all([
    api.storage(),
    api.credits({ range, operations: 'storage_daily', ...filter }),
    api.credits({ range, operations: 'storage_daily', group_by: 'day', ...filter }),
    api.credits({ range, operations: 'storage_daily', limit: 30, ...filter }),
  ]);

  $('files-size').textContent = fmtBytes(live.data.vfs_bytes);
  $('files-count').textContent = fmtExact(live.data.vfs_file_count);
  $('files-cost-30d').textContent = fmtCredits(toCredits(ledger.data.totals?.usd ?? 0));

  // Credits chart
  const labels = (costSeries.data.series || []).map(r => new Date(r.bucket).toISOString().slice(0, 10));
  const values = (costSeries.data.series || []).map(r => toCredits(r.usd));
  if (costChart) costChart.destroy();
  // eslint-disable-next-line no-undef
  costChart = new Chart($('chart-storage-cost'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Credits', data: values, backgroundColor: '#f26522' }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } } } },
  });

  const projBody = $('table-storage-projects').querySelector('tbody');
  if (!live.data.top_projects.length) projBody.innerHTML = emptyRow(3, 'No file storage yet.');
  else projBody.innerHTML = live.data.top_projects.map((p) => `
    <tr>
      <td>${escapeHtml(p.project_name || p.project_short_guid || '—')}</td>
      <td class="num">${fmtNum(p.files)}</td>
      <td class="num">${fmtBytes(p.bytes)}</td>
    </tr>
  `).join('');

  const chargesBody = $('table-storage-charges').querySelector('tbody');
  const days = aggregateByDay(recentCharges.data.items);
  if (!days.length) chargesBody.innerHTML = emptyRow(3, 'No file storage charges yet — meter runs daily at 03:00 UTC.');
  else chargesBody.innerHTML = days.map((d) => `
    <tr>
      <td class="muted">${escapeHtml(d.day)}</td>
      <td>Files</td>
      <td class="num">${fmtCredits(d.credits)}</td>
    </tr>
  `).join('');
}

async function renderDbSubtab(api, { range, projectId }) {
  const filter = projectId ? { app_guid: projectId } : {};
  const [schemas, ledger, recentCharges] = await Promise.all([
    api.dataDb(),
    api.credits({ range, operations: 'db_storage_daily', ...filter }),
    api.credits({ range, operations: 'db_storage_daily', limit: 30, ...filter }),
  ]);

  $('db-size').textContent = fmtBytes(schemas.data.total_bytes);
  $('db-schemas').textContent = fmtExact(schemas.data.schema_count);
  $('db-cost-30d').textContent = fmtCredits(toCredits(ledger.data.totals?.usd ?? 0));

  const schemasBody = $('table-db-schemas').querySelector('tbody');
  if (!schemas.data.schemas.length) {
    schemasBody.innerHTML = emptyRow(4, 'No databases yet. Create one with <code>gipity db query "CREATE TABLE ..."</code>.');
  } else {
    schemasBody.innerHTML = schemas.data.schemas.map((s) => `
      <tr>
        <td>${escapeHtml(s.project_name || s.project_short_guid)}</td>
        <td class="mono">${escapeHtml(s.database_name)}</td>
        <td class="num">${fmtNum(s.table_count)}</td>
        <td class="num">${fmtBytes(s.bytes)}</td>
      </tr>
    `).join('');
  }

  const chargesBody = $('table-db-charges').querySelector('tbody');
  const days = aggregateByDay(recentCharges.data.items);
  if (!days.length) chargesBody.innerHTML = emptyRow(2, 'No DB storage charges yet.');
  else chargesBody.innerHTML = days.map((d) => `
    <tr>
      <td class="muted">${escapeHtml(d.day)}</td>
      <td class="num">${fmtCredits(d.credits)}</td>
    </tr>
  `).join('');
}

export async function renderDataTab(api, filters) {
  if (!bound) {
    bound = true;
    document.querySelectorAll('[data-data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        showSubTab(btn.dataset.dataTab);
        renderDataTab(api, filters).catch((err) => console.error('[data] sub render failed', err));
      });
    });
    currentSub = subFromHash();
    showSubTab(currentSub);
  }
  switch (currentSub) {
    case 'files':   return renderFilesSubtab(api, filters);
    case 'db':      return renderDbSubtab(api, filters);
    default:        return renderFilesSubtab(api, filters);
  }
}
