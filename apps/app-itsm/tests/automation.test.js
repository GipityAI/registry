// Owner-run happy paths for the automation functions. The test database has
// the seed data (settings, SLA definitions, teams) but no incidents, so these
// cover the empty-queue and not-found paths without calling the LLM.

test('collect-kpis rolls up yesterday and is safe to re-run', async (ctx) => {
    const first = await ctx.fn.callAs(ctx.users.owner, 'collect-kpis', {});
    assert.match(first.period_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(first.kpis_collected >= 6, `expected at least 6 KPIs, got ${first.kpis_collected}`);
    assert.equal(first.summary.incident_volume, 0);
    const second = await ctx.fn.callAs(ctx.users.owner, 'collect-kpis', {});
    assert.equal(second.kpis_collected, first.kpis_collected);
});

test('check-sla-breaches runs clean on an empty queue', async (ctx) => {
    const r = await ctx.fn.callAs(ctx.users.owner, 'check-sla-breaches', {});
    assert.deepEqual(r.breached, []);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.total_checked, 0);
});

test('auto-close-resolved uses the seeded auto_close_days', async (ctx) => {
    const r = await ctx.fn.callAs(ctx.users.owner, 'auto-close-resolved', {});
    assert.equal(r.days, 7);
    assert.equal(r.closed, 0);
});

test('incident functions report a missing incident', async (ctx) => {
    const owner = ctx.users.owner;
    assert.equal((await ctx.fn.callAs(owner, 'calculate-sla', { incident_id: 999999 })).error, 'Incident not found');
    assert.equal((await ctx.fn.callAs(owner, 'classify-incident', { incident_id: 999999 })).error, 'Incident not found');
    assert.equal((await ctx.fn.callAs(owner, 'generate-kb-article', { incident_id: 999999 })).error, 'Incident not found');
    assert.equal((await ctx.fn.callAs(owner, 'escalate-incident', { incident_id: 999999 })).error, 'Incident not found');
    const assign = await ctx.fn.callAs(owner, 'smart-assign', { incident_id: 999999 });
    assert.equal(assign.assigned, false);
    assert.equal(assign.reason, 'Incident not found');
});

test('comment and request functions report a missing row', async (ctx) => {
    const owner = ctx.users.owner;
    assert.equal((await ctx.fn.callAs(owner, 'analyze-sentiment', { comment_id: 999999 })).error, 'Comment not found');
    assert.equal((await ctx.fn.callAs(owner, 'notify-request-approver', { request_id: 999999 })).error, 'Request not found');
});
