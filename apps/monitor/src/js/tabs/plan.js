/**
 * Plan tab: subscription tier, monthly credit grant, live balance, burn rate
 * and days-to-empty projection, the last grants/top-ups (`/account/logs/plan`),
 * and billing: change plan or buy a credit pack through Stripe Checkout, or
 * open the Stripe billing portal (`/credits/*`, the same routes as
 * `gipity credits`).
 */
import { fmtExact, fmtUsd, fmtTime, escapeHtml, emptyRow, fmtBytes } from '../format.js';

const $ = (id) => document.getElementById(id);
let bound = false;

/** Where Stripe sends the user back: this page's Plan tab. The server appends
 *  `?purchase=success|cancelled`, which lands in the hash query. */
function returnUrl() {
  return `${location.origin}${location.pathname}#plan`;
}

function purchaseNotice() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const status = q.get('purchase');
  const el = $('billing-notice');
  el.hidden = !status;
  if (status === 'success') el.innerHTML = '<span class="pill ok">Payment received</span> Your credits or plan update will show here within a minute.';
  else if (status === 'cancelled') el.innerHTML = '<span class="pill muted">Checkout cancelled</span> Nothing was charged.';
}

async function startCheckout(api, btn) {
  btn.disabled = true;
  try {
    const { checkoutUrl } = (await api.purchase(btn.dataset.price, returnUrl())).data;
    location.href = checkoutUrl;
  } catch (err) {
    btn.disabled = false;
    $('billing-error').textContent = err.message;
  }
}

async function openPortal(api) {
  $('billing-portal').disabled = true;
  try {
    const { portalUrl } = (await api.billingPortal(returnUrl())).data;
    location.href = portalUrl;
  } catch (err) {
    $('billing-portal').disabled = false;
    $('billing-error').textContent = err.message;
  }
}

function renderProducts(products) {
  const body = $('table-plan-products').querySelector('tbody');
  if (!products.length) { body.innerHTML = emptyRow(4, 'No plans or credit packs available right now.'); return; }
  body.innerHTML = products.map((p) => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td class="muted">${p.type === 'subscription' ? 'Monthly plan' : 'Credit pack'}</td>
      <td class="num">${fmtUsd(p.amountUsd)}${p.type === 'subscription' ? '/mo' : ''} · ${fmtExact(p.credits)} credits</td>
      <td class="row-actions">${p.available
        ? `<button type="button" class="primary-btn" data-price="${escapeHtml(p.priceId)}">${p.type === 'subscription' ? 'Switch' : 'Buy'}</button>`
        : `<span class="muted small">${p.type === 'subscription' ? 'Current plan' : 'Pro plan only'}</span>`}</td>
    </tr>`).join('');
}


// Friendly labels for the known plan-limit keys; anything unmapped falls back
// to a camelCase split so new limits still render (just less prettily).
const LIMIT_LABELS = {
  maxProjects: 'Projects',
  maxDatabases: 'Databases',
  storageQuotaBytes: 'Storage',
  maxWorkflows: 'Workflows',
  minCronIntervalHours: 'Cron frequency',
  maxConcurrentChats: 'Concurrent chats',
  deployRatePerMinute: 'Deploys/min',
  testFileConcurrency: 'Parallel tests',
};
// Nested serviceLimits (media generation entitlements). Convention:
// -1 = unlimited, 0 = Pro-only (blocked on free), N = N free uses/month.
const SERVICE_LABELS = {
  video: 'Video generation',
  music: 'Music generation',
  image: 'Image generation',
  audio: 'Speech & sound FX',
};

function prettyLimitKey(k) {
  return LIMIT_LABELS[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();
}
function prettyLimitValue(k, v) {
  if (v == null) return '-';
  if (k === 'storageQuotaBytes' || k.endsWith('Bytes')) return fmtBytes(Number(v));
  if (k === 'minCronIntervalHours') return Number(v) === 0 ? 'no minimum' : `${fmtExact(Number(v))}h minimum`;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return fmtExact(v);
  return String(v);
}
function fmtServiceLimit(v) {
  if (v === -1) return 'unlimited';
  if (v === 0) return 'Pro only';
  if (typeof v === 'number') return `${fmtExact(v)}/mo free`;
  return String(v);
}
// Flatten limits into [label, value] rows, expanding the nested serviceLimits
// object into one row per media service so nothing renders as "[object Object]".
function limitRowsFor(limits) {
  const rows = [];
  for (const [k, v] of Object.entries(limits)) {
    if (k === 'serviceLimits' && v && typeof v === 'object') {
      for (const sk of Object.keys(SERVICE_LABELS)) {
        if (v[sk] !== undefined) rows.push([SERVICE_LABELS[sk], fmtServiceLimit(v[sk])]);
      }
    } else {
      rows.push([prettyLimitKey(k), prettyLimitValue(k, v)]);
    }
  }
  return rows;
}

export async function renderPlanTab(api) {
  if (!bound) {
    bound = true;
    $('table-plan-products').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-price]');
      if (btn) startCheckout(api, btn);
    });
    $('billing-portal').addEventListener('click', () => openPortal(api));
  }
  purchaseNotice();
  $('billing-error').textContent = '';
  const [res, products] = await Promise.all([api.plan(), api.products()]);
  renderProducts(products.data);
  const { plan, balance, burn, effective_limits, recent_grants, api_tokens } = res.data;

  // Plan card folds the tier + monthly inclusion + price into one line so
  // it reads like a buyer-facing summary ("Pro · $20/mo · 20,000 credits/mo"),
  // not two separate cards.
  $('plan-name').textContent = plan
    ? `${plan.display_name} · ${fmtUsd(plan.monthly_price_usd)}/mo · ${fmtExact(plan.monthly_credits)} credits/mo`
    : '-';
  $('plan-remaining').textContent = fmtExact(balance.remaining);
  $('plan-tokens').textContent = fmtExact(api_tokens?.count ?? 0);
  $('plan-burn').textContent = burn.per_day != null ? `${fmtExact(Math.round(burn.per_day))} cr` : '-';
  $('plan-days').innerHTML = burn.days_to_empty == null
    ? '<span class="muted">∞</span>'
    : burn.days_to_empty < 7
      ? `<span class="pill error">${fmtExact(burn.days_to_empty)}d</span>`
      : burn.days_to_empty < 30
        ? `<span class="pill warn">${fmtExact(burn.days_to_empty)}d</span>`
        : `${fmtExact(burn.days_to_empty)}d`;

  // Effective limits (the snapshot applied to this user). Falls back to the
  // plan's published limits if the user has none yet.
  const limits = Object.keys(effective_limits || {}).length ? effective_limits : (plan?.limits || {});
  const limitsBody = $('table-plan-limits').querySelector('tbody');
  const limitRows = limitRowsFor(limits);
  if (!limitRows.length) limitsBody.innerHTML = emptyRow(2, 'No plan limits set.');
  else limitsBody.innerHTML = limitRows.map(([label, value]) => `
    <tr><td class="muted">${escapeHtml(label)}</td><td class="num">${escapeHtml(value)}</td></tr>
  `).join('');

  const balBody = $('table-plan-balance').querySelector('tbody');
  balBody.innerHTML = `
    <tr><td class="muted">Granted (lifetime active)</td><td class="num">${fmtExact(balance.granted)}</td></tr>
    <tr><td class="muted">Used</td><td class="num">${fmtExact(balance.used)}</td></tr>
    <tr><td class="muted">Remaining</td><td class="num">${fmtExact(balance.remaining)}</td></tr>
    <tr><td class="muted">Earliest expiry</td><td class="num">${balance.earliest_expires ? fmtTime(balance.earliest_expires) : '-'}</td></tr>
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
      <td class="num">${g.purchase_usd != null ? fmtUsd(g.purchase_usd) : '<span class="muted">-</span>'}</td>
    </tr>
  `).join('');
}
