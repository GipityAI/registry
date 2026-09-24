// Smoke tests for the stripe kit's functions, as wired into this app.
// `test` and `assert` are globals provided by the harness - do not import them.
//
// payment-events is normally invoked by the PLATFORM with a signature-verified
// Stripe event. Here we call it directly (it's a public function) with
// representative event payloads to prove fulfillment is idempotent and routes by
// event type. payment-status is the gating read used by the frontend.

test('payment-events records a one-time purchase (idempotent on session id)', async (ctx) => {
  const event = {
    id: 'evt_test_onetime',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_onetime_1', mode: 'payment', amount_total: 4900, currency: 'usd', customer: 'cus_test' } },
  };
  const first = await ctx.fn.call('payment-events', event);
  assert.equal(first.handled, 'checkout.session.completed');

  // Replaying the same event must not error (ON CONFLICT DO NOTHING).
  const replay = await ctx.fn.call('payment-events', event);
  assert.equal(replay.handled, 'checkout.session.completed');
});

test('payment-events ignores unrelated event types', async (ctx) => {
  const res = await ctx.fn.call('payment-events', {
    id: 'evt_test_other',
    type: 'payment_intent.created',
    data: { object: {} },
  });
  assert.equal(res.handled, 'ignored');
});

test('payment-events upserts a subscription lifecycle event', async (ctx) => {
  const res = await ctx.fn.call('payment-events', {
    id: 'evt_test_sub',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_test_1', customer: 'cus_test', status: 'active', current_period_end: 1893456000, items: { data: [{ price: { id: 'price_test' } }] } } },
  });
  assert.equal(res.handled, 'customer.subscription.updated');
});

test('payment-status is safe for an anonymous caller', async (ctx) => {
  // Called without a signed-in user → no userGuid → not active, no throw.
  const res = await ctx.fn.call('payment-status', {});
  assert.equal(res.active, false);
  assert.equal(res.subscription, null);
});

test('payment-status reports no subscription for a fresh signed-in user', async (ctx) => {
  const res = await ctx.fn.callAs(ctx.users.alice, 'payment-status', {});
  assert.equal(res.active, false);
});
