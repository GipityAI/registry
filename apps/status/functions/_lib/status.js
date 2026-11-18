// Status page rules: what is checked, how a check becomes a state, and how
// raw rows become the page's payload. Pure functions (no services), so the
// tests import and check them directly.

/**
 * Every component on the page, in display order. `url` components are an
 * HTTP GET (or HEAD) that must answer 2xx; `db` and `storage` are run inside
 * run-checks against this app's own database and files. A check slower than
 * `slowMs` counts as degraded.
 *
 * Functions may fetch only the public Gipity endpoints (GET/HEAD to
 * a.gipity.ai/health, a.gipity.ai/health/ai, a.gipity.ai/changelog, rt.gipity.ai/health, and any
 * path on app/dev/media/docs.gipity.ai), and each host must be listed in
 * run-checks' fetch_domains in gipity.yaml.
 */
export const COMPONENTS = [
  { key: 'api', name: 'API', description: 'Functions, sign-in, deploys and the CLI', url: 'https://a.gipity.ai/health', slowMs: 1500 },
  { key: 'hosting', name: 'App hosting', description: 'Live apps on app.gipity.ai and custom domains', url: 'https://app.gipity.ai/_error/404.html', slowMs: 1500 },
  { key: 'dev-hosting', name: 'Dev environments', description: 'Apps on dev.gipity.ai', url: 'https://dev.gipity.ai/_error/404.html', slowMs: 1500 },
  { key: 'db', name: 'Gipity DB', description: 'App databases', kind: 'db', slowMs: 500 },
  { key: 'storage', name: 'Gipity Storage', description: 'App files and uploads', kind: 'storage', slowMs: 1500 },
  { key: 'cdn', name: 'Gipity CDN', description: 'The client SDK and public files', url: 'https://media.gipity.ai/client/v1/gipity.js', method: 'HEAD', slowMs: 1500 },
  { key: 'realtime', name: 'Gipity Realtime', description: 'Multiplayer rooms and live updates', url: 'https://rt.gipity.ai/health', slowMs: 1500 },
  { key: 'ai', name: 'AI services', description: 'Models, image, video, speech and audio generation', url: 'https://a.gipity.ai/health/ai', slowMs: 1500 },
  { key: 'docs', name: 'Docs', description: 'docs.gipity.ai', url: 'https://docs.gipity.ai/', slowMs: 2000 },
  { key: 'changelog', name: 'Changelog', description: 'What is new, for gipity changelog', url: 'https://a.gipity.ai/changelog?last=1', slowMs: 2000 },
];

export const COMPONENT_KEYS = COMPONENTS.map(c => c.key);

/** The tiny public file the Storage check copies into this app once, then reads every minute. */
export const STORAGE_PROBE_SOURCE = 'https://app.gipity.ai/_error/404.html';

/** Days of history on the page, and of raw checks kept before maintain prunes them. */
export const HISTORY_DAYS = 90;

export const INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'];
export const INCIDENT_IMPACTS = ['minor', 'major'];

/** One check -> a state: failed = down, slower than the component's slowMs = degraded. */
export function classifyCheck(component, { ok, latencyMs }) {
  if (!ok) return 'down';
  if (latencyMs > component.slowMs) return 'degraded';
  return 'operational';
}

/**
 * A component's current state from its latest checks (newest first). One
 * failed check after good ones shows as degraded, not down: a single blip
 * (a dropped packet, a cold start) shouldn't paint the page red. Two failures
 * in a row is down. No checks in the last hour is unknown.
 */
export function currentState(statesNewestFirst) {
  if (!statesNewestFirst.length) return 'unknown';
  const [latest, previous] = statesNewestFirst;
  if (latest === 'down' && (previous === undefined || previous === 'down')) return 'down';
  if (latest !== 'operational') return 'degraded';
  return 'operational';
}

/**
 * One day's bar: no checks = none; 5% or more of checks down = down; any
 * down check, or 10% or more degraded = degraded; otherwise operational.
 */
export function dayState({ checks, down, degraded }) {
  if (!checks) return 'none';
  if (down / checks >= 0.05) return 'down';
  if (down > 0 || degraded / checks >= 0.1) return 'degraded';
  return 'operational';
}

/** Share of checks that were up (degraded counts as up), as a percent with 3 decimals; null with no checks. */
export function uptimePct(checks, down) {
  if (!checks) return null;
  return Math.round(((checks - down) / checks) * 100000) / 1000;
}

/** The headline over the whole page. */
export function overallState(componentStates, activeIncidents) {
  const down = componentStates.filter(s => s === 'down').length;
  if (down && down >= Math.ceil(componentStates.length / 2)) return 'major';
  if (down || activeIncidents.some(i => i.impact === 'major')) return 'partial';
  if (componentStates.includes('degraded') || activeIncidents.length) return 'degraded';
  if (componentStates.every(s => s === 'unknown')) return 'unknown';
  return 'operational';
}

/** `yyyy-mm-dd` (UTC) for a Date. */
export function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

/** The last `n` UTC days ending today, oldest first, as `yyyy-mm-dd`. */
export function lastDays(now, n) {
  const days = [];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = n - 1; i >= 0; i--) days.push(utcDay(new Date(today - i * 86_400_000)));
  return days;
}

/**
 * Assemble the public payload from query rows.
 *   recent:  { component, state, latency_ms, checked_at } newest first, up to 3 per component (last hour)
 *   last24h: { component, checks, down }
 *   days:    { component, day, checks, degraded, down } (rollups + raw days not rolled up yet)
 *   spark:   { component, hour, ms } oldest first
 *   incidents: rows with an `updates` array, newest first
 */
export function buildStatus({ now, recent, last24h, days, spark, incidents }) {
  const dayKeys = lastDays(now, HISTORY_DAYS);
  const week = new Set(dayKeys.slice(-7));
  const byComponent = (rows) => {
    const map = new Map(COMPONENT_KEYS.map(k => [k, []]));
    for (const r of rows) map.get(r.component)?.push(r);
    return map;
  };
  const recentBy = byComponent(recent);
  const dayBy = byComponent(days);
  const sparkBy = byComponent(spark);
  const h24 = new Map(last24h.map(r => [r.component, r]));

  const active = incidents.filter(i => i.status !== 'resolved');

  const components = COMPONENTS.map((c) => {
    const latest = recentBy.get(c.key);
    const dayMap = new Map(dayBy.get(c.key).map(r => [dayString(r.day), r]));
    let weekChecks = 0, weekDown = 0, allChecks = 0, allDown = 0;
    const history = dayKeys.map((day) => {
      const r = dayMap.get(day);
      const checks = r ? Number(r.checks) : 0;
      const down = r ? Number(r.down) : 0;
      const degraded = r ? Number(r.degraded) : 0;
      allChecks += checks; allDown += down;
      if (week.has(day)) { weekChecks += checks; weekDown += down; }
      return { day, state: dayState({ checks, down, degraded }), uptime: uptimePct(checks, down) };
    });
    const last = h24.get(c.key);
    const incident = active.find(i => i.components.includes(c.key));
    return {
      key: c.key,
      name: c.name,
      description: c.description,
      state: currentState(latest.map(r => r.state)),
      latency_ms: latest[0]?.latency_ms ?? null,
      checked_at: latest[0] ? new Date(latest[0].checked_at).toISOString() : null,
      incident: incident ? incident.short_guid : null,
      uptime: {
        '24h': last ? uptimePct(Number(last.checks), Number(last.down)) : null,
        '7d': uptimePct(weekChecks, weekDown),
        '90d': uptimePct(allChecks, allDown),
      },
      days: history,
      latency: sparkBy.get(c.key).map(r => ({ t: new Date(r.hour).toISOString(), ms: Number(r.ms) })),
    };
  });

  return {
    generated_at: now.toISOString(),
    overall: overallState(components.map(c => c.state), active),
    components,
    incidents: incidents.map(i => ({
      id: i.short_guid,
      title: i.title,
      components: i.components,
      impact: i.impact,
      status: i.status,
      started_at: new Date(i.started_at).toISOString(),
      resolved_at: i.resolved_at ? new Date(i.resolved_at).toISOString() : null,
      updates: (i.updates || []).map(u => ({ status: u.status, body: u.body, at: new Date(u.created_at).toISOString() })),
    })),
  };
}

/** A DATE column may arrive as a Date or a string; normalize to `yyyy-mm-dd`. */
function dayString(value) {
  return value instanceof Date ? utcDay(value) : String(value).slice(0, 10);
}

/** Validate an incident-post body. Returns { error } or the cleaned fields. */
export function parseIncidentInput(body) {
  const b = body || {};
  const out = {};
  if (b.incident !== undefined) {
    if (typeof b.incident !== 'string' || !b.incident) return { error: 'incident must be the id of an existing incident' };
    out.incident = b.incident;
  } else {
    if (typeof b.title !== 'string' || !b.title.trim() || b.title.length > 200) return { error: 'title is required (at most 200 characters)' };
    out.title = b.title.trim();
    const components = b.components ?? [];
    if (!Array.isArray(components) || components.some(k => !COMPONENT_KEYS.includes(k))) {
      return { error: `components must be a list of: ${COMPONENT_KEYS.join(', ')}` };
    }
    out.components = [...new Set(components)];
    const impact = b.impact ?? 'minor';
    if (!INCIDENT_IMPACTS.includes(impact)) return { error: `impact must be one of: ${INCIDENT_IMPACTS.join(', ')}` };
    out.impact = impact;
  }
  const status = b.status ?? (out.incident ? undefined : 'investigating');
  if (!INCIDENT_STATUSES.includes(status)) return { error: `status must be one of: ${INCIDENT_STATUSES.join(', ')}` };
  out.status = status;
  if (typeof b.body !== 'string' || !b.body.trim() || b.body.length > 5000) return { error: 'body is required (the update text, at most 5000 characters)' };
  out.body = b.body.trim();
  return out;
}
