/**
 * Overview tab — the default landing view. One screen that answers "is
 * anything wrong / what changed" and links every finding into the tab that
 * explains it. Composes existing /account/logs/* endpoints only (one extra
 * Promise.all fan-out); no Overview-specific backend.
 *
 * Zones:
 *   1. Health strip — stat tiles (errors, failed functions, live now, credits
 *      this month, storage). A tile is a STATUS surface: neutral when fine,
 *      warning/error tinted WITH an icon + label when not — the tint is never
 *      the only signal.
 *   2. Needs attention — top error issue, last failed workflow/job run, low
 *      credit runway, recently-fired alerts. Empty = one calm "All quiet ✓".
 *   3. Activity sparkline row — page views + service calls as two SEPARATE
 *      single-series charts (never two series on one axis).
 *   4. Recent deploys — last 3, linking into Hosting › Deploys.
 */
import { fmtNum, fmtExact, fmtTime, escapeHtml, truncate, padSeries } from '../format.js';
import { groupFor, lineChart, sparkline } from '../chart-helpers.js';

const $ = (id) => document.getElementById(id);
const charts = {};
function destroy(key) { if (charts[key]) { charts[key].destroy(); delete charts[key]; } }

function fmtBytes(n) {
  if (n == null || isNaN(n)) return '—';
  const KB = 1024, MB = KB * 1024, GB = MB * 1024;
  if (n >= GB) return (n / GB).toFixed(2) + ' GB';
  if (n >= MB) return (n / MB).toFixed(2) + ' MB';
  if (n >= KB) return (n / KB).toFixed(1) + ' KB';
  return `${n} B`;
}

/** Tint a health tile. `level` is '' (neutral) | 'warn' | 'error'; non-neutral
 *  levels also show the ⚠ icon + a short label so color is never the only
 *  signal. */
function setTile(id, level, note = '') {
  const tile = $(`ov-tile-${id}`);
  if (!tile) return;
  tile.classList.toggle('tile-warn', level === 'warn');
  tile.classList.toggle('tile-error', level === 'error');
  const noteEl = tile.querySelector('.tile-note');
  if (noteEl) {
    noteEl.textContent = note ? `⚠ ${note}` : '';
    noteEl.hidden = !note;
  }
}

function attentionRow({ tab, level, title, detail, time }) {
  return `
    <li class="attn-row row-link" data-goto="${escapeHtml(tab)}">
      <span class="pill ${level}">${level}</span>
      <span class="attn-title">${escapeHtml(title)}</span>
      ${detail ? `<span class="attn-detail">${escapeHtml(truncate(detail, 90))}</span>` : ''}
      ${time ? `<span class="attn-time">${escapeHtml(fmtTime(time))}</span>` : ''}
    </li>`;
}

export async function renderOverviewTab(api, { range, appGuid, projectId }) {
  const group = groupFor(range);

  // One fan-out; independent failures degrade their own zone, not the screen.
  const soft = (p, fallback) => p.catch((err) => {
    if (err.message === 'UNAUTHENTICATED') throw err;
    return fallback;
  });
  const [stats, sessions, fnTop, credits30, storage, errTs, trafficTs, servicesTs,
    topIssue, workflows, jobs, plan, alerts, deploys, creditsDaily] = await Promise.all([
    api.stats(range, projectId),
    soft(api.sessions(range, projectId), { data: { sessions: 0, live: 0 } }),
    soft(api.top('function', range, 50, projectId), { data: { items: [] } }),
    soft(api.credits({ range: '30d', ...(projectId ? { app_guid: projectId } : {}) }), { data: { totals: { credits: null } } }),
    soft(api.storage(), { data: {} }),
    soft(api.timeseries('errors', range, group, projectId), { data: { series: [] } }),
    soft(api.timeseries('traffic', range, group, projectId, undefined, 'deploy'), { data: { series: [], annotations: [] } }),
    soft(api.timeseries('services', range, group, projectId, 'count'), { data: { series: [] } }),
    soft(api.errors(appGuid, undefined, 1), { data: [] }),
    soft(api.workflows(range, projectId), { data: { recent: [] } }),
    soft(api.jobs(range, projectId), { data: { recent: [] } }),
    soft(api.plan(), { data: null }),
    soft(api.alerts(), { data: [] }),
    soft(api.audit('deploy', projectId, 3), { data: [] }),
    soft(api.credits({ range: '30d', group_by: 'day', ...(projectId ? { app_guid: projectId } : {}) }), { data: { series: [] } }),
  ]);

  // ── 1. Health strip ────────────────────────────────────────────────────
  const errCount = stats.data.cards.errors ?? 0;
  $('ov-errors').textContent = fmtExact(errCount);
  setTile('errors', errCount > 0 ? 'error' : '', errCount > 0 ? 'needs a look' : '');

  const failedFns = fnTop.data.items.reduce((s, f) => s + (f.error_count || 0), 0);
  $('ov-failed-fns').textContent = fmtExact(failedFns);
  setTile('failed-fns', failedFns > 0 ? 'warn' : '', failedFns > 0 ? 'failing calls' : '');

  $('ov-live').textContent = fmtExact(sessions.data.live);
  $('ov-credits').textContent = fmtExact(credits30.data.totals.credits);
  const s = storage.data.storage || {};
  $('ov-storage').textContent = fmtBytes(s.physicalBytes ?? storage.data.vfs_bytes);

  // Tile sparklines: errors over the window; credits over the last 30 days.
  const errSpark = padSeries(errTs.data.series, range, group);
  destroy('sparkErr');
  charts.sparkErr = sparkline($('ov-spark-errors'), { values: errSpark.values, color: errCount > 0 ? 'error' : 'text-faint' });
  const credSpark = (creditsDaily.data.series || []).map((r) => Number(r.usd) * 1000);
  destroy('sparkCred');
  charts.sparkCred = sparkline($('ov-spark-credits'), { values: credSpark.length ? credSpark : [0, 0], color: 'primary' });

  // ── 2. Needs attention ─────────────────────────────────────────────────
  const rows = [];
  if (topIssue.data[0]) {
    const e = topIssue.data[0];
    rows.push(attentionRow({ tab: 'errors', level: 'error', title: 'Top error issue', detail: e.message, time: e.last_seen_at }));
  }
  const failedWf = (workflows.data.recent || []).find((r) => !['success', 'ok'].includes((r.status || '').toLowerCase()));
  if (failedWf) rows.push(attentionRow({ tab: 'compute/workflows', level: 'warn', title: 'Workflow run failed', detail: failedWf.name, time: failedWf.started_at }));
  const failedJob = (jobs.data.recent || []).find((r) => !['success', 'ok'].includes((r.status || '').toLowerCase()));
  if (failedJob) rows.push(attentionRow({ tab: 'compute/jobs', level: 'warn', title: 'Job run failed', detail: failedJob.name, time: failedJob.created_at }));
  if (plan.data) {
    const { balance, burn } = plan.data;
    if (burn?.days_to_empty != null && burn.days_to_empty < 7) {
      rows.push(attentionRow({ tab: 'plan', level: 'error', title: `Credits run out in ~${fmtExact(burn.days_to_empty)} days`, detail: `${fmtExact(balance.remaining)} credits left` }));
    } else if (balance?.granted > 0 && balance.used / balance.granted >= 0.8) {
      rows.push(attentionRow({ tab: 'plan', level: 'warn', title: `${Math.round((balance.used / balance.granted) * 100)}% of granted credits used`, detail: `${fmtExact(balance.remaining)} remaining` }));
    }
  }
  const DAY = 86_400_000;
  for (const a of alerts.data) {
    if (a.last_fired_at && Date.now() - new Date(a.last_fired_at).getTime() < DAY) {
      rows.push(attentionRow({ tab: 'alerts', level: 'warn', title: `Alert fired: ${a.kind}`, time: a.last_fired_at }));
    }
  }
  $('ov-attention').innerHTML = rows.length
    ? rows.join('')
    : '<li class="attn-quiet">All quiet ✓ — nothing needs attention in this window.</li>';

  // ── 3. Activity sparkline row (two separate single-series charts) ──────
  const traffic = padSeries(trafficTs.data.series, range, group);
  destroy('trafficLine');
  charts.trafficLine = lineChart($('chart-ov-traffic'), { label: 'Page views', labels: traffic.labels, values: traffic.values, color: 'primary' });
  charts.trafficLine.$annotations = trafficTs.data.annotations || [];
  charts.trafficLine.update();
  const services = padSeries(servicesTs.data.series, range, group);
  destroy('servicesLine');
  charts.servicesLine = lineChart($('chart-ov-services'), { label: 'Service calls', labels: services.labels, values: services.values, color: 'info' });

  // ── 4. Recent deploys ──────────────────────────────────────────────────
  const dep = $('ov-deploys');
  if (!deploys.data.length) {
    dep.innerHTML = '<li class="attn-quiet">No deploys in this window — <code>gipity deploy dev</code> to ship one.</li>';
  } else {
    dep.innerHTML = deploys.data.map((e) => {
      const url = e.detail && typeof e.detail.url === 'string' ? e.detail.url : null;
      const ok = !String(e.event_type).includes('failure');
      return `
        <li class="attn-row row-link" data-goto="hosting/deploys">
          <span class="pill ${ok ? 'ok' : 'error'}">${ok ? 'deployed' : 'failed'}</span>
          <span class="attn-title">${escapeHtml(e.event_type)}</span>
          ${url ? `<span class="attn-detail">${escapeHtml(truncate(url, 60))}</span>` : ''}
          <span class="attn-time">${escapeHtml(fmtTime(e.created_at))}</span>
        </li>`;
    }).join('');
  }

  return { errorCount: errCount, uniqueVisitors: fmtNum(sessions.data.sessions) };
}
