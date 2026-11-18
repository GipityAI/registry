// Gipity Status page: fetch the public feed and render it, then refresh.
import { config } from './config.js';

const STATE_LABEL = {
  operational: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  unknown: 'No data yet',
};

const OVERALL_LABEL = {
  operational: 'All systems operational',
  degraded: 'Some systems degraded',
  partial: 'Partial outage',
  major: 'Major outage',
  unknown: 'Waiting for the first checks',
};

const INCIDENT_STATUS_LABEL = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
};

const $ = (id) => document.getElementById(id);

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

function pct(value) {
  return value == null ? '-' : `${value.toFixed(value === 100 ? 0 : 2)}%`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function sparkPoints(series) {
  if (series.length < 2) return '';
  const max = Math.max(...series.map(p => p.ms), 1);
  const step = 120 / (series.length - 1);
  return series.map((p, i) => `${(i * step).toFixed(1)},${(30 - (p.ms / max) * 28).toFixed(1)}`).join(' ');
}

function renderComponent(c) {
  const node = $('component-tpl').content.firstElementChild.cloneNode(true);
  node.dataset.state = c.state;
  node.querySelector('.name').textContent = c.name;
  node.querySelector('.desc').textContent = c.description;
  const pill = node.querySelector('.pill');
  pill.textContent = STATE_LABEL[c.state] || c.state;
  pill.dataset.state = c.state;

  const bars = node.querySelector('.bars');
  bars.setAttribute('aria-label', `${c.name}: daily history for the last 90 days`);
  for (const d of c.days) {
    const bar = el('span', 'bar');
    bar.dataset.state = d.state;
    const day = dayFmt.format(new Date(`${d.day}T00:00:00Z`));
    bar.title = d.state === 'none' ? `${day}: no data` : `${day}: ${pct(d.uptime)} up`;
    bars.append(bar);
  }
  node.querySelector('.uptime-90').textContent = `${pct(c.uptime['90d'])} uptime`;
  node.querySelector('.u24').textContent = pct(c.uptime['24h']);
  node.querySelector('.u7').textContent = pct(c.uptime['7d']);
  node.querySelector('.u90').textContent = pct(c.uptime['90d']);

  node.querySelector('.spark polyline').setAttribute('points', sparkPoints(c.latency));
  node.querySelector('.latency-now').textContent = c.latency_ms == null ? '' : `${c.latency_ms} ms`;
  return node;
}

function renderIncident(i, componentNames) {
  const card = el('article', 'incident');
  card.dataset.impact = i.impact;
  card.dataset.status = i.status;
  card.append(el('h3', null, i.title));
  const meta = el('p', 'muted');
  const affected = i.components.map(k => componentNames.get(k) || k).join(', ');
  meta.textContent = [
    INCIDENT_STATUS_LABEL[i.status] || i.status,
    affected ? `Affects ${affected}` : null,
    `Started ${dateTimeFmt.format(new Date(i.started_at))}`,
    i.resolved_at ? `Resolved ${dateTimeFmt.format(new Date(i.resolved_at))}` : null,
  ].filter(Boolean).join(' · ');
  card.append(meta);
  const list = el('ol', 'updates');
  for (const u of i.updates) {
    const item = el('li');
    item.append(el('strong', null, `${INCIDENT_STATUS_LABEL[u.status] || u.status} `), el('span', 'muted', dateTimeFmt.format(new Date(u.at))));
    item.append(el('p', null, u.body));
    list.append(item);
  }
  card.append(list);
  return card;
}

function render(status) {
  const overall = $('overall');
  overall.dataset.state = status.overall;
  $('overall-text').textContent = OVERALL_LABEL[status.overall] || status.overall;
  $('updated').textContent = `Updated ${timeFmt.format(new Date(status.generated_at))}`;

  $('components').replaceChildren(...status.components.map(renderComponent));

  const names = new Map(status.components.map(c => [c.key, c.name]));
  const active = status.incidents.filter(i => i.status !== 'resolved');
  const past = status.incidents.filter(i => i.status === 'resolved');
  $('active-incidents').hidden = active.length === 0;
  $('active-list').replaceChildren(...active.map(i => renderIncident(i, names)));
  if (past.length) $('past-list').replaceChildren(...past.map(i => renderIncident(i, names)));
  else $('past-list').replaceChildren(el('p', 'muted', 'No incidents in the last 30 days.'));
}

/** The feed's public URL, from the SDK tag the deploy stamps with this
 *  environment's app guid and API host. */
function feedUrl() {
  const sdk = document.querySelector('script[src*="/client/v1/gipity.js"]');
  if (!sdk?.dataset.app || !sdk.dataset.apiBase) return null;
  return `${sdk.dataset.apiBase}/api/${sdk.dataset.app}/fn/${config.feedFunction}`;
}

async function refresh() {
  try {
    render(await Gipity.fn(config.feedFunction));
  } catch (err) {
    console.warn('status feed unavailable:', err);
    $('overall').dataset.state = 'unknown';
    $('overall-text').textContent = 'Status feed unreachable. Retrying in a minute.';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const url = feedUrl();
  if (url) $('feed-link').href = url;
  else $('feed-link').hidden = true;
  refresh();
  setInterval(refresh, config.refreshMs);
});
