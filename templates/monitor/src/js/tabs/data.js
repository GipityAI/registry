/**
 * Data tab — two sub-tabs covering persistent storage:
 *   - Files: total bytes (live count) + per-project breakdown + storage cost chart.
 *   - DB:    Per-project Postgres schema bytes (live from userdata cluster) +
 *            table counts + recent db_storage_daily charges.
 *
 * CDN + Domains used to live here too but moved to the Hosting tab — they're
 * about delivery, not persistence.
 */
import { fmtNum, fmtExact, fmtCredits, fmtBytes, toCredits, escapeHtml, emptyRow } from '../format.js';
import { barChart } from '../chart-helpers.js';
import { requestRender, subTabs, hashPath } from '../ui.js';

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


// ── File-version retention (Data › Files) ─────────────────────────────────
// The plan sets the MAX days/copies of history Gipity keeps + bills for; the
// user may lower it to store/pay less, never raise it above the cap. Source:
// GET /users/me → data.stats.versionRetention { days, count, maxDays, maxCount }.
function setRetentionStatus(msg, isError) {
  const el = $('retention-status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('error', !!isError);
}

function applyRetention(r) {
  if (!r) return;
  const { days, count, maxDays, maxCount } = r;
  $('retention-summary').textContent =
    `Keeping ${days} days / ${count} copies (whichever comes first). ` +
    `Your plan allows up to ${maxDays} days / ${maxCount} copies.`;
  const daysInput = $('retention-days');
  const countInput = $('retention-count');
  daysInput.value = days;
  daysInput.max = maxDays;
  countInput.value = count;
  countInput.max = maxCount;
}

async function loadRetention(api) {
  const r = (await api.me())?.data?.stats?.versionRetention;
  applyRetention(r);
}

async function saveRetention(api, ev) {
  if (ev) ev.preventDefault();
  const days = Number($('retention-days').value);
  const count = Number($('retention-count').value);
  setRetentionStatus('Saving…', false);
  try {
    const res = await api.setRetention({ days, count });
    applyRetention(res?.data);
    setRetentionStatus('Saved.', false);
  } catch (err) {
    setRetentionStatus(err.message || 'Save failed', true);
  }
}

async function resetRetention(api) {
  setRetentionStatus('Resetting…', false);
  try {
    const res = await api.setRetention({ days: null, count: null });
    applyRetention(res?.data);
    setRetentionStatus('Reset to plan default.', false);
  } catch (err) {
    setRetentionStatus(err.message || 'Reset failed', true);
  }
}

const tabs = subTabs('data', 'data', ['files', 'db']);

function showSubTab(name) {
  currentSub = name;
  tabs.show(name);
}

async function renderFilesSubtab(api, { range, projectId }) {
  // All credit queries follow the range + project filters so card / chart /
  // table all describe the same window for the same scope. (Previously this
  // was hard-coded to 30d and account-wide regardless of the picker.)
  const filter = projectId ? { app_guid: projectId } : {};
  const [live, ledger, costSeries, recentCharges] = await Promise.all([
    api.storage(projectId),
    api.credits({ range, operations: 'storage_daily', ...filter }),
    api.credits({ range, operations: 'storage_daily', group_by: 'day', ...filter }),
    api.credits({ range, operations: 'storage_daily', limit: 30, ...filter }),
  ]);

  // Storage breakdown: billed (physical, dedup-counted-once, incl. versions),
  // live (what you have now), total-with-versions, and dedup savings.
  const s = live.data.storage || {};
  $('files-size').textContent = fmtBytes(s.physicalBytes ?? live.data.vfs_bytes);
  $('files-live').textContent = fmtBytes(s.liveBytes ?? live.data.vfs_bytes);
  $('files-count').textContent = fmtExact(s.liveFiles ?? live.data.vfs_file_count);
  $('files-versioned').textContent = fmtBytes(s.versionedBytes ?? live.data.vfs_bytes);
  $('files-dedup').textContent = fmtBytes(s.dedupSavedBytes ?? 0);
  $('files-cost-30d').textContent = fmtCredits(toCredits(ledger.data.totals?.usd ?? 0));

  // Credits chart
  const labels = (costSeries.data.series || []).map(r => new Date(r.bucket).toISOString().slice(0, 10));
  const values = (costSeries.data.series || []).map(r => toCredits(r.usd));
  if (costChart) costChart.destroy();
  costChart = barChart($('chart-storage-cost'), { label: 'Credits', labels, values, color: 'primary' });

  const projBody = $('table-storage-projects').querySelector('tbody');
  const shown = live.data.top_projects;
  if (!shown.length) projBody.innerHTML = emptyRow(3, 'No file storage yet.');
  else {
    // The endpoint returns only the biggest projects. Add a row for the rest so
    // the table never reads as the full list when it isn't.
    const hidden = live.data.project_count - shown.length;
    const hiddenBytes = live.data.project_total_bytes - shown.reduce((n, p) => n + p.bytes, 0);
    const hiddenFiles = live.data.project_total_files - shown.reduce((n, p) => n + p.files, 0);
    projBody.innerHTML = shown.map((p) => `
    <tr>
      <td>${escapeHtml(p.project_name || p.project_short_guid || '—')}</td>
      <td class="num">${fmtNum(p.files)}</td>
      <td class="num">${fmtBytes(p.bytes)}</td>
    </tr>
  `).join('') + (hidden > 0 ? `
    <tr>
      <td class="muted">…and ${fmtNum(hidden)} more</td>
      <td class="num muted">${fmtNum(hiddenFiles)}</td>
      <td class="num muted">${fmtBytes(hiddenBytes)}</td>
    </tr>
  ` : '');
  }

  // Version-retention policy — loaded independently so a /users/me hiccup
  // never blocks the storage cards/tables above.
  loadRetention(api).catch((err) => {
    if (err.message !== 'UNAUTHENTICATED') console.error('[data] retention load failed', err);
    setRetentionStatus('Could not load retention policy.', true);
  });

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
    api.dataDb(projectId),
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
        // Via the orchestrator: this closure's `filters` are frozen at first bind.
        requestRender();
      });
    });
    $('retention-form').addEventListener('submit', (ev) => saveRetention(api, ev));
    $('retention-reset').addEventListener('click', () => resetRetention(api));
  }
  // Re-read the sub-tab from the hash on every render so cross-tab links
  // land on the right sub view.
  if (hashPath().split('/')[0] === 'data') showSubTab(tabs.fromHash());
  switch (currentSub) {
    case 'files':   return renderFilesSubtab(api, filters);
    case 'db':      return renderDbSubtab(api, filters);
    default:        return renderFilesSubtab(api, filters);
  }
}
