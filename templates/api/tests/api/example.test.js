// Smoke test for the example function. Replace with tests for your own functions.
// `test` and `assert` are provided as globals by the harness - do not import them.

test('example returns ok', async (ctx) => {
    const res = await ctx.fn.call('example', {});
    assert.equal(res.ok, true);
});
