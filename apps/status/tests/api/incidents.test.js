// incident-post / incident-delete and how incidents show in the status feed.

test('incident functions are owner-only', async (ctx) => {
  const body = { title: 'x', body: 'y' };
  await assert.rejects(() => ctx.fn.call('incident-post', body));
  await assert.rejects(() => ctx.fn.callAs(ctx.users.alice, 'incident-post', body), /403 FORBIDDEN/);
  await assert.rejects(() => ctx.fn.callAs(ctx.users.alice, 'incident-delete', { incident: 'inc_x' }), /403 FORBIDDEN/);
});

test('incident-post rejects bad input', async (ctx) => {
  const res = await ctx.fn.callAs(ctx.users.owner, 'incident-post', { title: 'x', components: ['nope'], body: 'y' });
  assert.match(res.error, /components/);
  const missing = await ctx.fn.callAs(ctx.users.owner, 'incident-post', { incident: 'inc_missing', status: 'resolved', body: 'y' });
  assert.equal(missing.error, 'incident not found');
});

test('an incident is open, updated, then resolved', async (ctx) => {
  const created = await ctx.fn.callAs(ctx.users.owner, 'incident-post', {
    title: 'Slow deploys', components: ['api'], impact: 'major', body: 'Looking into slow deploys.',
  });
  assert.equal(created.ok, true);
  assert.equal(created.status, 'investigating');

  let status = await ctx.fn.call('status', {});
  let inc = status.incidents.find(i => i.id === created.incident);
  assert.equal(inc.status, 'investigating');
  assert.equal(inc.resolved_at, null);
  assert.equal(status.overall, 'partial', 'an open major incident is a partial outage');
  assert.equal(status.components.find(c => c.key === 'api').incident, created.incident);

  await ctx.fn.callAs(ctx.users.owner, 'incident-post', { incident: created.incident, status: 'identified', body: 'Found it.' });
  const resolved = await ctx.fn.callAs(ctx.users.owner, 'incident-post', { incident: created.incident, status: 'resolved', body: 'Fixed.' });
  assert.equal(resolved.status, 'resolved');

  status = await ctx.fn.call('status', {});
  inc = status.incidents.find(i => i.id === created.incident);
  assert.equal(inc.status, 'resolved');
  assert.ok(inc.resolved_at);
  assert.deepEqual(inc.updates.map(u => u.status), ['resolved', 'identified', 'investigating']);
  assert.equal(status.components.find(c => c.key === 'api').incident, null);
});

test('incident-delete removes an incident and its updates', async (ctx) => {
  const created = await ctx.fn.callAs(ctx.users.owner, 'incident-post', { title: 'Oops', body: 'Posted by mistake.' });
  const del = await ctx.fn.callAs(ctx.users.owner, 'incident-delete', { incident: created.incident });
  assert.equal(del.ok, true);
  const status = await ctx.fn.call('status', {});
  assert.equal(status.incidents.find(i => i.id === created.incident), undefined);
  const again = await ctx.fn.callAs(ctx.users.owner, 'incident-delete', { incident: created.incident });
  assert.equal(again.error, 'incident not found');
});
