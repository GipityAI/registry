// Test the Recent Lookups API - verifies persistence works end-to-end
//
// Tests run in a sandboxed harness. `test()` and `assert` are provided as
// globals - do NOT import `node:test` or `node:assert`. Use `ctx.fn.call()`
// to invoke deployed functions. `ctx.fn.call` returns your function's return
// value directly - the `{ data }` envelope is unwrapped - so read `result.field`
// (an error your function returns is `result.error`). Write a test for every
// new function you add.

test('get-recent returns lookups including one we just made', async (ctx) => {
    // Make a lookup first
    const wx = await ctx.fn.call('get-weather', { zip: '10001' });
    assert.ok(wx.short_guid, 'weather lookup should return a short_guid');

    // Fetch recent
    const recent = await ctx.fn.call('get-recent', {});
    assert.ok(Array.isArray(recent.lookups), 'should return lookups array');
    assert.ok(recent.lookups.length > 0, 'should have at least one lookup');

    const found = recent.lookups.find(l => l.short_guid === wx.short_guid);
    assert.ok(found, 'recent lookups should include the one we just made');
    assert.equal(found.zip, '10001');
});

test('get-recent respects limit parameter', async (ctx) => {
    const result = await ctx.fn.call('get-recent', { limit: 1 });
    assert.ok(result.lookups.length <= 1, 'should respect limit of 1');
});
