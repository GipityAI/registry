// Smoke test for the example function. Replace with tests for your own functions.
// `test` and `assert` are provided as globals by the harness - do not import them.
//
// Data isolation (know these before writing DB tests - see the app-testing skill):
// - Tests run against a throwaway copy of your database, reset once per RUN,
//   not per test: rows earlier tests inserted are still there when yours runs.
//   Assert on rows you can identify (filter/count by your own marker), never on
//   a table's total contents.
// - `ctx.testId` is stable per FILE (all tests in this file share it). It keeps
//   FILES from colliding on unique names; add your own suffix when a single
//   test needs exclusive rows.
// - `ctx.fn.call()` is unauthenticated: on an `auth: user` function it THROWS
//   (assert that gate with assert.rejects). Test the signed-in path with
//   `ctx.fn.callAs(ctx.users.alice, name, params)`.

test('example returns ok', async (ctx) => {
    const res = await ctx.fn.call('example', {});
    assert.equal(res.ok, true);
});
