// Test the Recent Lookups API - verifies persistence works end-to-end
//
// Tests run in a sandboxed harness. `test()` and `assert` are provided as
// globals - do NOT import `node:test` or `node:assert`. Use `ctx.fn.call()`
// to invoke deployed functions. Write a test for every new function you add.

test('get-recent returns lookups including one we just made', async (ctx) => {
    // Make a lookup first
    const wx = await ctx.fn.call('get-weather', { zip: '10001' });
    assert.ok(wx.data.short_guid, 'weather lookup should return a short_guid');

    // Fetch recent
    const recent = await ctx.fn.call('get-recent', {});
    assert.ok(Array.isArray(recent.data.lookups), 'should return lookups array');
    assert.ok(recent.data.lookups.length > 0, 'should have at least one lookup');

    const found = recent.data.lookups.find(l => l.short_guid === wx.data.short_guid);
    assert.ok(found, 'recent lookups should include the one we just made');
    assert.equal(found.zip, '10001');
});

test('get-recent respects limit parameter', async (ctx) => {
    const result = await ctx.fn.call('get-recent', { limit: 1 });
    assert.ok(result.data.lookups.length <= 1, 'should respect limit of 1');
});
