/**
 * Plan tab — subscription tier, monthly credit grant, live balance, burn rate
 * and days-to-empty projection, plus the last grants/top-ups. Single endpoint
 * (`/account/logs/plan`) backs everything here.
 */
import { fmtExact, fmtUsd, fmtTime, escapeHtml, emptyRow } from '../format.js';

const $ = (id) => document.getElementById(id);

function fmtBytes(n) {
  if (n == null || isNaN(n)) return '—';
  const KB = 1024, MB = KB * 1024, GB = MB * 1024;
  if (n >= GB) return (n / GB).toFixed(2) + ' GB';
  if (n >= MB) return (n / MB).toFixed(2) + ' MB';
  if (n >= KB) return (n / KB).toFixed(1) + ' KB';
  return `${n} B`;
}

// Light formatter for plan_limits keys — these are camelCase + bytes/seconds units.
function prettyLimitKey(k) {
  return k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();
}
function prettyLimitValue(k, v) {
  if (v == null) return '—';
  if (k.endsWith('Bytes')) return fmtBytes(Number(v));
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return fmtExact(v);
  return String(v);
}

export async function renderPlanTab(api) {
  const res = await api.plan();
  const { plan, balance, burn, effective_limits, recent_grants, api_tokens } = res.data;

  // Plan card folds the tier + monthly inclusion + price into one line so
  // it reads like a buyer-facing summary ("Pro · $20/mo · 20,000 credits/mo"),
  // not two separate cards.
  $('plan-name').textContent = plan
    ? `${plan.display_name} · ${fmtUsd(plan.monthly_price_usd)}/mo · ${fmtExact(plan.monthly_credits)} credits/mo`
    : '—';
  $('plan-remaining').textContent = fmtExact(balance.remaining);
  $('plan-tokens').textContent = fmtExact(api_tokens?.count ?? 0);
  $('plan-burn').textContent = burn.per_day != null ? `${fmtExact(Math.round(burn.per_day))} cr` : '—';
  $('plan-days').innerHTML = burn.days_to_empty == null
    ? '<span class="muted">∞</span>'
    : burn.days_to_empty < 7
      ? `<span class="pill pill-error">${fmtExact(burn.days_to_empty)}d</span>`
      : burn.days_to_empty < 30
        ? `<span class="pill pill-warn">${fmtExact(burn.days_to_empty)}d</span>`
        : `${fmtExact(burn.days_to_empty)}d`;

  // Effective limits (the snapshot applied to this user). Falls back to the
  // plan's published limits if the user has none yet.
  const limits = Object.keys(effective_limits || {}).length ? effective_limits : (plan?.limits || {});
  const limitsBody = $('table-plan-limits').querySelector('tbody');
  const limitRows = Object.entries(limits);
  if (!limitRows.length) limitsBody.innerHTML = emptyRow(2, 'No plan limits set.');
  else limitsBody.innerHTML = limitRows.map(([k, v]) => `
    <tr><td class="muted">${escapeHtml(prettyLimitKey(k))}</td><td class="num">${escapeHtml(prettyLimitValue(k, v))}</td></tr>
  `).join('');

  const balBody = $('table-plan-balance').querySelector('tbody');
  balBody.innerHTML = `
    <tr><td class="muted">Granted (lifetime active)</td><td class="num">${fmtExact(balance.granted)}</td></tr>
    <tr><td class="muted">Used</td><td class="num">${fmtExact(balance.used)}</td></tr>
    <tr><td class="muted">Remaining</td><td class="num">${fmtExact(balance.remaining)}</td></tr>
    <tr><td class="muted">Earliest expiry</td><td class="num">${balance.earliest_expires ? fmtTime(balance.earliest_expires) : '—'}</td></tr>
    <tr><td class="muted">Used last 30d</td><td class="num">${fmtExact(burn.credits_used_30d)} cr</td></tr>
  `;

  const grantsBody = $('table-plan-grants').querySelector('tbody');
  if (!recent_grants.length) grantsBody.innerHTML = emptyRow(7, 'No grants or purchases yet.');
  else grantsBody.innerHTML = recent_grants.map((g) => `
    <tr>
      <td class="muted">${fmtTime(g.granted_at)}</td>
      <td class="muted">${escapeHtml(g.source)}</td>
      <td class="num">${fmtExact(g.credits_granted)}</td>
      <td class="num muted">${fmtExact(g.credits_used)}</td>
      <td class="num">${fmtExact(g.credits_remaining)}</td>
      <td class="muted">${fmtTime(g.expires_at)}</td>
      <td class="num">${g.purchase_usd != null ? fmtUsd(g.purchase_usd) : '<span class="muted">—</span>'}</td>
    </tr>
  `).join('');
}
