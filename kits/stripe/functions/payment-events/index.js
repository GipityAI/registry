// Stripe payments kit — fulfillment hook.
//
// The PLATFORM invokes this function with a SIGNATURE-VERIFIED Stripe Connect
// event in ctx.body (shape: { id, type, account, data: { object } }). Because
// the platform already verified the webhook signature, this function does NO
// crypto — it just records the outcome in the payments/subscriptions tables.
// Kit-owned (sealed): re-add the kit at a newer version to upgrade it.
export default async function paymentEvents(ctx, { db, guid }) {
  const event = ctx.body || {};
  const obj = (event.data && event.data.object) || {};

  switch (event.type) {
    case 'checkout.session.completed': {
      const userGuid = obj.client_reference_id || (obj.metadata && obj.metadata.gipity_user_guid) || null;
      const email = (obj.customer_details && obj.customer_details.email) || obj.customer_email || null;
      await db.query(
        `INSERT INTO payments
           (id, stripe_session_id, stripe_customer_id, user_guid, mode, amount_total, currency, status, email)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'paid', $8)
         ON CONFLICT (stripe_session_id) DO NOTHING`,
        [guid('pay'), obj.id, obj.customer || null, userGuid, obj.mode || 'payment', obj.amount_total ?? null, obj.currency || null, email],
      );
      // A subscription checkout also seeds the subscription row so gating works
      // immediately, even before the first customer.subscription.updated arrives.
      if (obj.mode === 'subscription' && obj.subscription) {
        await upsertSubscription(db, {
          id: obj.subscription,
          customer: obj.customer || null,
          user_guid: userGuid,
          status: 'active',
          price_id: null,
          period_end: null,
        });
      }
      return { handled: event.type };
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      await upsertSubscription(db, {
        id: obj.id,
        customer: obj.customer || null,
        user_guid: (obj.metadata && obj.metadata.gipity_user_guid) || null,
        status: obj.status || 'active',
        price_id: priceIdOf(obj),
        period_end: obj.current_period_end || null,
      });
      return { handled: event.type };
    }

    case 'customer.subscription.deleted': {
      await db.query(
        `UPDATE subscriptions SET status = 'canceled', updated_at = NOW() WHERE stripe_subscription_id = $1`,
        [obj.id],
      );
      return { handled: event.type };
    }

    case 'invoice.paid': {
      // Renewal: keep the period end fresh so gating doesn't lapse mid-cycle.
      const sub = obj.subscription;
      const periodEnd = obj.lines && obj.lines.data && obj.lines.data[0] && obj.lines.data[0].period
        ? obj.lines.data[0].period.end : null;
      if (sub) {
        await db.query(
          `UPDATE subscriptions
             SET status = 'active',
                 current_period_end = COALESCE(to_timestamp($2), current_period_end),
                 updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [sub, periodEnd],
        );
      }
      return { handled: event.type };
    }

    default:
      return { handled: 'ignored', type: event.type };
  }
}

function priceIdOf(subscription) {
  const item = subscription.items && subscription.items.data && subscription.items.data[0];
  return (item && item.price && item.price.id) || null;
}

async function upsertSubscription(db, s) {
  await db.query(
    `INSERT INTO subscriptions
       (stripe_subscription_id, stripe_customer_id, user_guid, status, price_id, current_period_end, updated_at)
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6), NOW())
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET
       stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
       user_guid          = COALESCE(EXCLUDED.user_guid, subscriptions.user_guid),
       status             = EXCLUDED.status,
       price_id           = COALESCE(EXCLUDED.price_id, subscriptions.price_id),
       current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
       updated_at         = NOW()`,
    [s.id, s.customer, s.user_guid, s.status, s.price_id, s.period_end],
  );
}
