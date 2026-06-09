// Test the Weather API
// Source of truth: templates/_shared/tests/weather.test.js
//
// Tests run in a sandboxed harness. `test()` and `assert` are provided as
// globals - do NOT import `node:test` or `node:assert`. Use `ctx.fn.call()`
// to invoke deployed functions. `ctx.fn.call` returns your function's return
// value directly - the `{ data }` envelope is unwrapped - so read `result.field`
// (an error your function returns is `result.error`). Write a test for every
// new function you add.

test('get-weather returns weather for a valid zip code', async (ctx) => {
    const result = await ctx.fn.call('get-weather', { zip: '10001' });
    assert.ok(result.location, 'should have a location');
    assert.equal(result.zip, '10001');
    assert.ok(typeof result.temperature_f === 'number', 'temperature should be a number');
    assert.ok(result.condition, 'should have a condition');
    assert.ok(typeof result.humidity === 'number', 'humidity should be a number');
    assert.ok(typeof result.wind_mph === 'number', 'wind should be a number');
    assert.ok(result.commentary, 'should have commentary');
    assert.ok(result.timestamp, 'should have a timestamp');
});

test('get-weather returns error for invalid zip', async (ctx) => {
    const result = await ctx.fn.call('get-weather', { zip: 'abc' });
    assert.ok(result.error, 'should return an error');
    assert.ok(result.error.includes('zip code'), 'error should mention zip code');
});

test('get-weather returns error for missing zip', async (ctx) => {
    const result = await ctx.fn.call('get-weather', {});
    assert.ok(result.error, 'should return an error');
});
