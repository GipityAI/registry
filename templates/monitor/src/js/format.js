// Small formatting helpers shared across tabs.

// Compact form for high-volume counts where readability matters more than
// exact value (page views, function calls, etc.). DO NOT use for credits or
// money - those need fmtExact / fmtUsd to avoid hiding a few hundred dollars
// behind "7.0k".
export function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(Math.round(n));
}

// Exact integer-comma format for top-line credit totals + transaction counts
// where rounding to "7.0k" would mislead. Rounds to a whole number so a
// summary card stays scannable (use fmtCredits for fractional per-row values).
export function fmtExact(n) {
  if (n == null) return '—';
  return Math.round(n).toLocaleString();
}

// Per-row credit value display - keeps fractional precision (up to 4 decimals,
// matching credit_ledger.credits_deducted's DECIMAL(14,4)) AND adds comma
// thousands separators. Use anywhere a single ledger row's credit amount is
// shown. Sub-1 credits like 0.0138 render exactly; "1234.5000" trims trailing
// zeros to "1,234.5".
export function fmtCredits(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

// USD display. Always shows comma thousands separators ($1,234.56) so big
// totals don't look like a single fused number. Sub-dollar amounts get extra
// decimals so we don't display "$0" for real-but-tiny costs.
export function fmtUsd(n) {
  if (n == null) return '—';
  if (n >= 1) return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  if (n > 0) return `$${n.toFixed(5)}`;
  return '$0';
}

export function fmtMs(n) {
  if (n == null) return '—';
  if (n < 1000) return `${n}ms`;
  return `${(n / 1000).toFixed(2)}s`;
}

export function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return `${n.toFixed(1)}%`;
}

/**
 * Format a {current, prev, delta_pct} triple into a small "↑ 23%" / "↓ 5%" badge.
 * direction: 'up_good' (e.g. traffic, sessions) | 'up_bad' (e.g. errors, cost)
 * When delta_pct is null (prev was 0 and current > 0), shows "new"; null+null → no badge.
 */
export function fmtDelta(cmp, direction = 'up_good') {
  if (!cmp) return '';
  const { current, prev, delta_pct } = cmp;
  if (delta_pct === null) {
    if (current > 0 && prev === 0) return '<span class="delta neutral">new</span>';
    return '';
  }
  if (Math.abs(delta_pct) < 0.5) return '<span class="delta neutral">±0%</span>';
  const up = delta_pct > 0;
  const isGood = (up && direction === 'up_good') || (!up && direction === 'up_bad');
  const cls = isGood ? 'delta good' : 'delta bad';
  const arrow = up ? '↑' : '↓';
  return `<span class="${cls}">${arrow} ${Math.abs(delta_pct).toFixed(0)}%</span>`;
}

export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const ageMin = Math.round((now - d) / 60000);
  if (ageMin < 1) return 'just now';
  if (ageMin < 60) return `${ageMin}m ago`;
  if (ageMin < 60 * 24) return `${Math.round(ageMin / 60)}h ago`;
  return `${Math.round(ageMin / (60 * 24))}d ago`;
}

export function fmtFullTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}

export function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function statusPill(status) {
  const s = (status || '').toLowerCase();
  const cls = s === 'ok' || s === 'success' ? 'pill-ok'
    : s === 'error' || s === 'failed' ? 'pill-error'
    : s === 'warn' || s === 'timeout' ? 'pill-warn'
    : 'pill-info';
  return `<span class="pill ${cls}">${escapeHtml(status || '—')}</span>`;
}

export function emptyRow(cols, msg = 'No data in this window.') {
  return `<tr><td colspan="${cols}" class="empty">${msg}</td></tr>`;
}

// ─── Chart bucket helpers ─────────────────────────────────────

const RANGE_TO_MS = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000, '1y': 31_536_000_000 };

function truncTo(d, group) {
  const x = new Date(d);
  if (group === 'minute') x.setSeconds(0, 0);
  else if (group === 'hour') x.setMinutes(0, 0, 0);
  else x.setHours(0, 0, 0, 0);
  return x;
}

const STEP_MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000 };

/**
 * Generate the full grid of bucket starts (local time) for the given range +
 * group, so the chart's X-axis spans the whole window even when most buckets
 * are empty. Returns an array of Date objects in ascending order.
 */
export function expectedBuckets(range, group) {
  const stepMs = STEP_MS[group] ?? STEP_MS.day;
  const now = Date.now();
  const start = truncTo(new Date(now - RANGE_TO_MS[range]), group);
  const end = truncTo(new Date(now), group);
  const out = [];
  for (let t = start.getTime(); t <= end.getTime(); t += stepMs) {
    out.push(new Date(t));
  }
  return out;
}

/**
 * Left-join server-returned `{ bucket, value }` series into the full expected
 * grid for (range, group). Buckets without server data get `fill` (0).
 * Returns `{ labels, values }` ready for Chart.js.
 */
export function padSeries(serverSeries, range, group, fill = 0) {
  const byKey = new Map();
  for (const r of serverSeries) {
    const t = truncTo(new Date(r.bucket), group).getTime();
    byKey.set(t, Number(r.value));
  }
  const buckets = expectedBuckets(range, group);
  return {
    labels: buckets.map((d) => fmtBucket(d, range, group)),
    values: buckets.map((d) => byKey.get(d.getTime()) ?? fill),
  };
}

/**
 * Smart label format for chart axes.
 *   minute group: "HH:MM" local time (1-min ticks)
 *   hour group:   "HH:MM" local time (every-hour tick at :00)
 *   day group + 7d:  "Mon Jan 23"
 *   day group + 30d: "Jan 23"
 * Year is always omitted.
 */
export function fmtBucket(input, range, group) {
  const d = input instanceof Date ? input : new Date(input);
  if (group === 'minute' || group === 'hour') {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const month = d.toLocaleString(undefined, { month: 'short' });
  const day = d.getDate();
  if (range === '7d') {
    const wk = d.toLocaleString(undefined, { weekday: 'short' });
    return `${wk} ${month} ${day}`;
  }
  return `${month} ${day}`;
}
