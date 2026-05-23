// Test the Weather API
// Source of truth: scaffolds/_shared/tests/weather.test.js
//
// Tests run in a sandboxed harness. `test()` and `assert` are provided as
// globals - do NOT import `node:test` or `node:assert`. Use `ctx.fn.call()`
// to invoke deployed functions. Write a test for every new function you add.

test('get-weather returns weather for a valid zip code', async (ctx) => {
    const result = await ctx.fn.call('get-weather', { zip: '10001' });
    assert.ok(result.data.location, 'should have a location');
    assert.equal(result.data.zip, '10001');
    assert.ok(typeof result.data.temperature_f === 'number', 'temperature should be a number');
    assert.ok(result.data.condition, 'should have a condition');
    assert.ok(typeof result.data.humidity === 'number', 'humidity should be a number');
    assert.ok(typeof result.data.wind_mph === 'number', 'wind should be a number');
    assert.ok(result.data.commentary, 'should have commentary');
    assert.ok(result.data.timestamp, 'should have a timestamp');
});

test('get-weather returns error for invalid zip', async (ctx) => {
    const result = await ctx.fn.call('get-weather', { zip: 'abc' });
    assert.ok(result.data.error, 'should return an error');
    assert.ok(result.data.error.includes('zip code'), 'error should mention zip code');
});

test('get-weather returns error for missing zip', async (ctx) => {
    const result = await ctx.fn.call('get-weather', {});
    assert.ok(result.data.error, 'should return an error');
});
