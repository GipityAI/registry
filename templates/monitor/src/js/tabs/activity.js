/**
 * Activity tab — unified recent-activity timeline.
 *
 * Calls /account/logs/activity (account-scoped equivalent of the project-
 * scoped `gipity logs app` endpoint). Renders each entry as one card with:
 *   - kind tag (error / function / service / traffic)
 *   - severity color
 *   - one-line summary
 *   - per-kind detail (network context, breadcrumbs trail, correlated
 *     server-side function row, error message + stack)
 *
 * The toolbar filters (severity, types, search) drive query params. Severity
 * filter only narrows log_errors rows; function/service failures always show
 * regardless.
 */
import { fmtTime, truncate, escapeHtml } from '../format.js';

const $ = (id) => document.getElementById(id);

const KIND_COLORS = {
  error:    '#e74c3c',
  function: '#f39c12',
  service:  '#f39c12',
  traffic:  '#7f8c8d',
};

function rangeToSince(range) {
  // Monitor's global range selector uses '1h' / '24h' / '7d' / etc. — same
  // strings the activity endpoint accepts as `since`.
  return range || '24h';
}

function renderBreadcrumbs(crumbs) {
  if (!Array.isArray(crumbs) || crumbs.length === 0) return '';
  const items = crumbs.slice(-6).map((c) => {
    const d = c.detail || {};
    const label = d.selector || d.url || d.path || d.args || '';
    return `<span class="crumb crumb-${escapeHtml(c.kind)}">${escapeHtml(c.kind)}${label ? ': ' + escapeHtml(truncate(String(label), 80)) : ''}</span>`;
  }).join('<span class="crumb-sep">›</span>');
  return `<div class="activity-crumbs">${items}</div>`;
}

function renderError(d) {
  const out = [];
  out.push(`<div class="activity-msg mono">${escapeHtml(truncate(d.message || '', 400))}</div>`);
  if (d.network_url) {
    out.push(`<div class="activity-net mono">${escapeHtml(d.captured_by || 'fetch')} → ${escapeHtml(d.network_method || 'GET')} <span class="net-url">${escapeHtml(d.network_url)}</span> <span class="net-status">${escapeHtml(String(d.network_status ?? 'failed'))}</span></div>`);
  }
  if (d.network_response_snippet) {
    out.push(`<details class="activity-extra"><summary>Response body</summary><pre class="mono">${escapeHtml(truncate(d.network_response_snippet, 800))}</pre></details>`);
  }
  if (d.correlated_function_log) {
    const c = d.correlated_function_log;
    out.push(`<div class="activity-corr">└─ server function <code>${escapeHtml(c.function_name)}</code> → <span class="status-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span>${c.error_message ? ` — ${escapeHtml(truncate(c.error_message, 200))}` : ''}</div>`);
  }
  if (d.stack && !d.network_url) {
    out.push(`<details class="activity-extra"><summary>Stack</summary><pre class="mono">${escapeHtml(truncate(d.stack, 2000))}</pre></details>`);
  }
  out.push(renderBreadcrumbs(d.breadcrumbs));
  if (d.occurrence_count && d.occurrence_count > 1) {
    out.push(`<div class="activity-extra muted small">Seen ${d.occurrence_count}× in this hour</div>`);
  }
  return out.join('');
}

function renderFunction(d) {
  const dur = d.duration_ms != null ? `${d.duration_ms}ms` : '—';
  return `
    <div class="activity-meta">
      <code>${escapeHtml(d.function_name)}</code>
      <span class="muted">${escapeHtml(d.trigger_type || '?')} • ${escapeHtml(dur)}</span>
    </div>
    ${d.error_message ? `<div class="activity-msg mono">${escapeHtml(truncate(d.error_message, 400))}</div>` : ''}
  `;
}

function renderService(d) {
  return `
    <div class="activity-meta">
      <code>${escapeHtml(d.service)}</code>
      <span class="muted">${escapeHtml(d.provider || '?')} / ${escapeHtml(d.model || '?')} • ${escapeHtml(d.latency_ms != null ? d.latency_ms + 'ms' : '—')}</span>
    </div>
    ${d.error_message ? `<div class="activity-msg mono">${escapeHtml(truncate(d.error_message, 400))}</div>` : ''}
  `;
}

function renderTraffic(d) {
  return `<div class="activity-meta"><code>${escapeHtml(d.path || '/')}</code>${d.referrer ? ` <span class="muted">← ${escapeHtml(d.referrer)}</span>` : ''}</div>`;
}

function entryBody(e) {
  if (e.kind === 'error')    return renderError(e.detail);
  if (e.kind === 'function') return renderFunction(e.detail);
  if (e.kind === 'service')  return renderService(e.detail);
  if (e.kind === 'traffic')  return renderTraffic(e.detail);
  return '';
}

function renderTimeline(ol, entries) {
  if (!entries.length) {
    ol.innerHTML = '<li class="muted small">No activity in this window.</li>';
    return;
  }
  ol.innerHTML = entries.map((e) => {
    const color = KIND_COLORS[e.kind] || '#888';
    return `
      <li class="activity-entry activity-${e.kind} severity-${e.severity || 'info'}">
        <div class="activity-line">
          <span class="activity-time muted mono">${escapeHtml(fmtTime(e.at))}</span>
          <span class="activity-kind" style="background:${color}">${escapeHtml(e.kind)}</span>
          <span class="activity-summary">${escapeHtml(truncate(e.summary, 200))}</span>
          ${e.detail && e.detail.app_guid ? `<span class="muted small">${escapeHtml(e.detail.app_guid)}</span>` : ''}
        </div>
        <div class="activity-detail">${entryBody(e)}</div>
      </li>
    `;
  }).join('');
}

// One-time wiring (idempotent — main.js calls renderActivityTab on every tab
// switch / range change, but we only need to bind the toolbar listeners once).
function ensureWired(api, getContext) {
  const root = $('activity-timeline');
  if (root.dataset.wired) return;
  root.dataset.wired = '1';

  const refresh = () => renderActivityTab(api, getContext());
  ['activity-severity', 'activity-types'].forEach((id) => {
    $(id).addEventListener('change', refresh);
  });
  // Debounce search a touch so each keystroke doesn't fire a request.
  let searchT = null;
  $('activity-search').addEventListener('input', () => {
    clearTimeout(searchT);
    searchT = setTimeout(refresh, 250);
  });
}

let lastContextRef = null;

export async function renderActivityTab(api, { range, appGuid }) {
  lastContextRef = { range, appGuid };
  ensureWired(api, () => lastContextRef);

  const status = $('activity-status');
  const ol = $('activity-timeline');
  status.textContent = 'Loading…';

  const severity = $('activity-severity').value || 'all';
  const type = $('activity-types').value || 'errors,functions,services';
  const filter = ($('activity-search').value || '').trim();
  const since = rangeToSince(range);

  try {
    const res = await api.activity({
      app_guid: appGuid,
      since,
      severity,
      type,
      filter: filter || undefined,
      limit: 200,
    });
    const { entries, truncated, count } = res.data;
    status.textContent = `${count}${truncated ? '+' : ''} entries • last ${res.data.since}`;
    renderTimeline(ol, entries);
  } catch (err) {
    status.textContent = '';
    ol.innerHTML = `<li class="muted small">Error loading activity: ${escapeHtml(err.message || String(err))}</li>`;
  }
}
