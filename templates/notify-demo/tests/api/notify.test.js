// Smoke test for the send-ping function. `test` and `assert` are harness globals.
//
// A fresh app has no push subscriptions, so a send reaches zero devices and is
// not charged. We assert send-ping runs cleanly and reports that — or, if the
// run lacks an authenticated user / credits, returns a clear error (never throws).

test('send-ping runs and reports zero deliveries for a fresh app', async (ctx) => {
  const res = await ctx.fn.call('send-ping', { to: 'self', message: 'hello' });
  if (res.ok) {
    assert.equal(res.sent, 0, 'no subscribers yet, so nothing is delivered');
    assert.equal(res.failed, 0);
  } else {
    assert.equal(typeof res.error, 'string', 'a non-ok result carries a clear error message');
  }
});
