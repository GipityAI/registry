// Smoke tests for the send-ping function. `test` and `assert` are harness globals.
//
// send-ping is declared `auth: user` in gipity.yaml, so the platform rejects an
// anonymous call BEFORE the handler runs - and `ctx.fn.call()` (which carries
// only the public app token) THROWS on that rejection. The anonymous path is
// therefore asserted with assert.rejects, and the real behavior is exercised
// signed-in via `ctx.fn.callAs` with a harness fixture user.
//
// A fresh app has no push subscriptions, so a signed-in send reaches zero
// devices and is not charged. (During `gipity test` the platform also
// suppresses real push delivery entirely - same return shape, no delivery.)

test('send-ping rejects anonymous callers (auth: user gate)', async (ctx) => {
    await assert.rejects(() => ctx.fn.call('send-ping', { to: 'self', message: 'hello' }));
});

test('send-ping runs signed-in and reports zero deliveries for a fresh app', async (ctx) => {
    const res = await ctx.fn.callAs(ctx.users.alice, 'send-ping', { to: 'self', message: 'hello' });
    assert.equal(res.ok, true);
    assert.equal(res.sent, 0, 'no subscribers yet, so nothing is delivered');
    assert.equal(res.failed, 0);
});
