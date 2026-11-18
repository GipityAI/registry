// Unit tests for the status rules in functions/_lib/status.js (no network,
// no database). `test` and `assert` are harness globals.
import {
  COMPONENTS, COMPONENT_KEYS, HISTORY_DAYS, buildStatus, classifyCheck, currentState,
  dayState, lastDays, overallState, parseIncidentInput, uptimePct,
} from '../../functions/_lib/status.js';

const api = COMPONENTS.find(c => c.key === 'api');

test('classifyCheck: failed is down, slow is degraded, otherwise operational', () => {
  assert.equal(classifyCheck(api, { ok: false, latencyMs: 10 }), 'down');
  assert.equal(classifyCheck(api, { ok: true, latencyMs: api.slowMs + 1 }), 'degraded');
  assert.equal(classifyCheck(api, { ok: true, latencyMs: api.slowMs }), 'operational');
});

test('currentState: one failure is degraded, two in a row is down', () => {
  assert.equal(currentState([]), 'unknown');
  assert.equal(currentState(['operational', 'down']), 'operational');
  assert.equal(currentState(['down', 'operational']), 'degraded');
  assert.equal(currentState(['down', 'down', 'operational']), 'down');
  assert.equal(currentState(['down']), 'down');
  assert.equal(currentState(['degraded', 'operational']), 'degraded');
});

test('dayState thresholds', () => {
  assert.equal(dayState({ checks: 0, down: 0, degraded: 0 }), 'none');
  assert.equal(dayState({ checks: 1440, down: 0, degraded: 10 }), 'operational');
  assert.equal(dayState({ checks: 1440, down: 1, degraded: 0 }), 'degraded');
  assert.equal(dayState({ checks: 1440, down: 0, degraded: 144 }), 'degraded');
  assert.equal(dayState({ checks: 1440, down: 72, degraded: 0 }), 'down');
});

test('uptimePct counts degraded as up and is null with no checks', () => {
  assert.equal(uptimePct(0, 0), null);
  assert.equal(uptimePct(1440, 0), 100);
  assert.equal(uptimePct(1440, 1), 99.931);
});

test('overallState', () => {
  assert.equal(overallState(['operational', 'operational'], []), 'operational');
  assert.equal(overallState(['operational', 'degraded'], []), 'degraded');
  assert.equal(overallState(['operational', 'operational'], [{ impact: 'minor' }]), 'degraded');
  assert.equal(overallState(['operational', 'operational'], [{ impact: 'major' }]), 'partial');
  assert.equal(overallState(['down', 'operational', 'operational'], []), 'partial');
  assert.equal(overallState(['down', 'down', 'operational'], []), 'major');
  assert.equal(overallState(['unknown', 'unknown'], []), 'unknown');
});

test('lastDays ends today (UTC), oldest first', () => {
  const days = lastDays(new Date('2026-03-02T05:00:00Z'), 3);
  assert.deepEqual(days, ['2026-02-28', '2026-03-01', '2026-03-02']);
});

test('parseIncidentInput validates new incidents and updates', () => {
  assert.match(parseIncidentInput({}).error, /title/);
  assert.match(parseIncidentInput({ title: 'x', components: ['nope'], body: 'b' }).error, /components/);
  assert.match(parseIncidentInput({ title: 'x', impact: 'huge', body: 'b' }).error, /impact/);
  assert.match(parseIncidentInput({ title: 'x' }).error, /body/);
  assert.match(parseIncidentInput({ incident: 'inc_1', body: 'b' }).error, /status/);
  assert.deepEqual(parseIncidentInput({ title: ' Slow ', components: ['api', 'api'], body: ' hi ' }), {
    title: 'Slow', components: ['api'], impact: 'minor', status: 'investigating', body: 'hi',
  });
  assert.deepEqual(parseIncidentInput({ incident: 'inc_1', status: 'resolved', body: 'done' }), {
    incident: 'inc_1', status: 'resolved', body: 'done',
  });
});

test('buildStatus assembles uptime windows, history and incident links', () => {
  const now = new Date('2026-05-10T12:00:00Z');
  const days = lastDays(now, HISTORY_DAYS);
  const rows = [
    { component: 'api', day: days[0], checks: 1000, degraded: 0, down: 1000 },   // 90 days ago: all down
    { component: 'api', day: days[89], checks: 100, degraded: 0, down: 0 },      // today: all up
  ];
  const status = buildStatus({
    now,
    recent: [{ component: 'api', state: 'operational', latency_ms: 120, checked_at: '2026-05-10T11:59:00Z' }],
    last24h: [{ component: 'api', checks: 100, down: 0 }],
    days: rows,
    spark: [{ component: 'api', hour: '2026-05-10T11:00:00Z', ms: 120 }],
    incidents: [{
      short_guid: 'inc_1', title: 'Slow API', components: ['api'], impact: 'minor', status: 'monitoring',
      started_at: '2026-05-10T10:00:00Z', resolved_at: null,
      updates: [{ status: 'monitoring', body: 'Watching', created_at: '2026-05-10T10:30:00Z' }],
    }],
  });
  assert.equal(status.components.length, COMPONENT_KEYS.length);
  const apiRow = status.components.find(c => c.key === 'api');
  assert.equal(apiRow.state, 'operational');
  assert.equal(apiRow.latency_ms, 120);
  assert.equal(apiRow.days.length, HISTORY_DAYS);
  assert.equal(apiRow.days[0].state, 'down');
  assert.equal(apiRow.days[89].state, 'operational');
  assert.equal(apiRow.days[50].state, 'none');
  assert.equal(apiRow.uptime['24h'], 100);
  assert.equal(apiRow.uptime['7d'], 100);
  assert.equal(apiRow.uptime['90d'], Math.round((100 / 1100) * 100000) / 1000);
  assert.equal(apiRow.incident, 'inc_1');
  assert.equal(apiRow.latency.length, 1);
  const db = status.components.find(c => c.key === 'db');
  assert.equal(db.state, 'unknown');
  assert.equal(db.uptime['24h'], null);
  assert.equal(status.overall, 'degraded', 'an open incident marks the page degraded');
  assert.equal(status.incidents[0].updates[0].body, 'Watching');
});
