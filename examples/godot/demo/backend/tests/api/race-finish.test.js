// race-finish tests. `test`/`assert` are harness globals.
test('race-finish logs laps and returns the running totals', async (ctx) => {
  const a = await ctx.fn.callAs(ctx.users.alice, 'race-finish', { lapMs: 5200 });
  assert.equal(a.laps, 1);
  assert.equal(a.bestMs, 5200);
  assert.equal(a.signedInWith, 'gipity');
  const b = await ctx.fn.callAs(ctx.users.alice, 'race-finish', { lapMs: 4900 });
  assert.equal(b.laps, 2);
  assert.equal(b.bestMs, 4900);
});

test('race-finish rejects a bad lap time', async (ctx) => {
  const r = await ctx.fn.callAs(ctx.users.alice, 'race-finish', { lapMs: -1 });
  assert.match(r.error, /positive integer/);
});

test('race-finish needs a signed-in player', async (ctx) => {
  let threw = false;
  try { await ctx.fn.call('race-finish', { lapMs: 5000 }); } catch { threw = true; }
  assert.equal(threw, true);
});
