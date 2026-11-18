// run-checks, status and maintain against the real functions. Each test file
// gets its own throwaway database, so the rows here are ours alone.
import { COMPONENT_KEYS, HISTORY_DAYS } from '../../functions/_lib/status.js';

const STATES = ['operational', 'degraded', 'down'];

setup(async (ctx) => {
  ctx.fixtures.run = await ctx.fn.callAs(ctx.users.owner, 'run-checks', {});
});

test('run-checks is owner-only', async (ctx) => {
  await assert.rejects(() => ctx.fn.call('run-checks', {}));
  await assert.rejects(() => ctx.fn.callAs(ctx.users.alice, 'run-checks', {}), /403 FORBIDDEN/);
});

test('run-checks records one result per component', async (ctx) => {
  const { checked, results } = ctx.fixtures.run;
  assert.equal(checked, COMPONENT_KEYS.length);
  assert.deepEqual(results.map(r => r.component).sort(), [...COMPONENT_KEYS].sort());
  for (const r of results) {
    assert.ok(STATES.includes(r.state), `${r.component} state ${r.state}`);
    assert.equal(typeof r.latency_ms, 'number');
  }
});

test('the database and storage checks pass against the app itself', async (ctx) => {
  const byKey = Object.fromEntries(ctx.fixtures.run.results.map(r => [r.component, r]));
  assert.notEqual(byKey.db.state, 'down', `db: ${byKey.db.error}`);
  assert.notEqual(byKey.storage.state, 'down', `storage: ${byKey.storage.error}`);
  assert.equal(byKey.storage.error, null);
});

test('the public endpoint checks reach Gipity', async (ctx) => {
  for (const r of ctx.fixtures.run.results.filter(x => x.component !== 'db' && x.component !== 'storage')) {
    assert.equal(r.error, null, `${r.component}: ${r.error}`);
    assert.ok(r.http_status >= 200 && r.http_status < 300, `${r.component}: HTTP ${r.http_status}`);
  }
});

test('status is public and reflects the latest checks', async (ctx) => {
  const status = await ctx.fn.call('status', {});
  assert.ok(['operational', 'degraded', 'partial', 'major'].includes(status.overall));
  assert.equal(status.components.length, COMPONENT_KEYS.length);
  for (const c of status.components) {
    assert.ok(c.checked_at, `${c.key} has a checked_at`);
    assert.equal(c.days.length, HISTORY_DAYS);
    assert.notEqual(c.days[HISTORY_DAYS - 1].state, 'none', `${c.key} has today's bar`);
    assert.equal(typeof c.uptime['24h'], 'number');
  }
  assert.deepEqual(status.incidents, []);
});

test('maintain is owner-only', async (ctx) => {
  await assert.rejects(() => ctx.fn.callAs(ctx.users.alice, 'maintain', {}), /403 FORBIDDEN/);
});

test('maintain rolls days up before pruning, so history survives', async (ctx) => {
  await ctx.fn.callAs(ctx.users.owner, 'run-checks', {});
  // Pretend it is 91 days later: today's checks are a finished day (rolled
  // up) and older than the retention window (pruned).
  const later = new Date(Date.now() + (HISTORY_DAYS + 1) * 86_400_000).toISOString();
  const res = await ctx.fn.callAs(ctx.users.owner, 'maintain', { now: later });
  assert.ok(res.rolled_up >= COMPONENT_KEYS.length, `rolled_up ${res.rolled_up}`);
  assert.ok(res.pruned >= COMPONENT_KEYS.length * 2, `pruned ${res.pruned}`);

  const status = await ctx.fn.call('status', {});
  for (const c of status.components) {
    assert.equal(c.checked_at, null, `${c.key}: raw checks are gone`);
    assert.notEqual(c.days[HISTORY_DAYS - 1].state, 'none', `${c.key}: today's bar comes from the rollup`);
    assert.equal(typeof c.uptime['90d'], 'number');
  }

  const again = await ctx.fn.callAs(ctx.users.owner, 'maintain', { now: later });
  assert.equal(again.pruned, 0, 'a second run has nothing left to prune');
});

test('maintain with the real clock keeps recent checks', async (ctx) => {
  await ctx.fn.callAs(ctx.users.owner, 'run-checks', {});
  const res = await ctx.fn.callAs(ctx.users.owner, 'maintain', {});
  assert.equal(res.pruned, 0);
  const status = await ctx.fn.call('status', {});
  assert.ok(status.components.every(c => c.checked_at), 'fresh checks are kept');
});
