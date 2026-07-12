/**
 * Thin client for /account/logs/*. Uses session cookie (Sign in with Gipity)
 * to authenticate via `credentials: 'include'`.
 */
const API_BASE = 'https://a.gipity.ai';

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (res.status === 401) throw new Error('UNAUTHENTICATED');
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

async function send(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error('UNAUTHENTICATED');
  if (res.status === 204) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API ${res.status}: ${path}`);
  }
  return res.json();
}

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const api = {
  // Aggregates. `projectFilter` is the project picker's value — a short_guid
  // (not the integer id) — which the server resolves via the `app_guid` param.
  stats: (range, projectFilter) =>
    getJson(`/account/logs/stats${qs({ range, app_guid: projectFilter })}`),
  latency: (signal, range, projectFilter) =>
    getJson(`/account/logs/stats/latency${qs({ signal, range, app_guid: projectFilter })}`),
  sessions: (range, projectFilter) =>
    getJson(`/account/logs/stats/sessions${qs({ range, app_guid: projectFilter })}`),
  timeseries: (signal, range, group, projectFilter, metric, annotations) =>
    getJson(`/account/logs/timeseries${qs({ signal, range, group, app_guid: projectFilter, metric, annotations })}`),
  top: (signal, range, limit, projectFilter) =>
    getJson(`/account/logs/top${qs({ signal, range, limit, app_guid: projectFilter })}`),
  apps: () => getJson('/account/logs/apps'),
  // All projects the user owns - used by the picker so the user can filter by
  // any project, including ones with no telemetry yet.
  projects: () => getJson('/account/logs/projects'),

  // Lists
  traffic: (appGuid, limit) =>
    getJson(`/account/logs/traffic${qs({ app_guid: appGuid, limit })}`),
  errors: (appGuid, q, limit) =>
    getJson(`/account/logs/errors${qs({ app_guid: appGuid, q, limit })}`),
  services: (appGuid, service, limit) =>
    getJson(`/account/logs/services${qs({ app_guid: appGuid, service, limit })}`),
  functions: (appGuid, limit) =>
    getJson(`/account/logs/functions${qs({ app_guid: appGuid, limit })}`),
  chats: (appGuid, range, limit) =>
    getJson(`/account/logs/chats${qs({ app_guid: appGuid, range, limit })}`),
  chatMessages: (guid, limit) =>
    getJson(`/account/logs/chats/${encodeURIComponent(guid)}/messages${qs({ limit })}`),
  audit: (type, appGuid, limit) =>
    getJson(`/account/logs/audit${qs({ type, app_guid: appGuid, limit })}`),
  errorHistory: (hash, appGuid) =>
    getJson(`/account/logs/errors/${encodeURIComponent(hash)}/history${qs({ app_guid: appGuid })}`),

  // Realtime — live CCU + room counts from the matchmaker.
  realtimeLive: () => getJson('/account/logs/realtime/live'),
  realtimeSummary: (range, appGuid) =>
    getJson(`/account/logs/realtime/summary${qs({ range, app_guid: appGuid })}`),

  // Credit ledger backbone — used by Spend, Storage, Compute, Browser, Search.
  credits: (opts = {}) => getJson(`/account/logs/credits${qs(opts)}`),
  storage: (appGuid) => getJson(`/account/logs/storage${qs({ app_guid: appGuid })}`),
  dataDb: (appGuid) => getJson(`/account/logs/data/db${qs({ app_guid: appGuid })}`),
  dataCdn: () => getJson('/account/logs/data/cdn'),
  jobs: (range, appGuid) =>
    getJson(`/account/logs/jobs${qs({ range, app_guid: appGuid })}`),
  workflows: (range, appGuid) =>
    getJson(`/account/logs/workflows${qs({ range, app_guid: appGuid })}`),

  // Account profile — includes stats.versionRetention { days, count, maxDays,
  // maxCount } (effective file-version retention + plan caps).
  me: () => getJson('/users/me'),
  // Lower (or reset) the file-version retention policy. A number sets it
  // (1..cap); null resets that dimension to the plan default. Returns
  // { data: { days, count, maxDays, maxCount, customDays, customCount } }.
  setRetention: (body) => send('PATCH', '/users/me/retention', body),

  // Plan + balance + custom domains + remote-control surfaces.
  plan: () => getJson('/account/logs/plan'),
  domains: () => getJson('/account/logs/data/domains'),
  remote: (range, appGuid) => getJson(`/account/logs/remote${qs({ range, app_guid: appGuid })}`),

  // Alerts CRUD
  alerts: () => getJson('/account/alerts'),
  alertEvents: (id) => getJson(`/account/alerts/${encodeURIComponent(id)}/events`),
  createAlert: (body) => send('POST', '/account/alerts', body),
  updateAlert: (id, body) => send('PATCH', `/account/alerts/${encodeURIComponent(id)}`, body),
  deleteAlert: (id) => send('DELETE', `/account/alerts/${encodeURIComponent(id)}`),

  // Secrets — encrypted app/account secrets (names + masked previews only,
  // never values). scope is 'project' (needs appGuid) or 'account'.
  listSecrets: (scope, appGuid) =>
    getJson(`/secrets${qs({ scope, app_guid: scope === 'project' ? appGuid : undefined })}`),
  setSecret: (scope, appGuid, name, value) =>
    send('PUT', `/secrets${qs({ scope, app_guid: scope === 'project' ? appGuid : undefined })}`, { name, value }),
  deleteSecret: (scope, appGuid, name) =>
    send('DELETE', `/secrets/${encodeURIComponent(name)}${qs({ scope, app_guid: scope === 'project' ? appGuid : undefined })}`),

  // Digest email preferences
  getDigestPref: () => getJson('/account/alerts/digest'),
  setDigestPref: (cadence, email) => send('PUT', '/account/alerts/digest', { cadence, email }),

  // Unified per-app activity timeline (errors + failed fns + failed services +
  // optional traffic) — same data that backs `gipity logs app`. The Monitor's
  // Activity tab is the visual surface; this is its single endpoint.
  activity: (opts = {}) => getJson(`/account/logs/activity${qs(opts)}`),
};
