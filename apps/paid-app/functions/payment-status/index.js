// Stripe payments kit — subscription status for the signed-in caller (auth: user).
// Used by the frontend to gate "Pro"/members-only UI. Kit-owned (sealed).
export default async function paymentStatus(ctx, { db }) {
  const userGuid = ctx.auth && ctx.auth.userGuid;
  if (!userGuid) return { active: false, subscription: null };

  const { rows } = await db.query(
    `SELECT stripe_subscription_id, stripe_customer_id, status, price_id, current_period_end
       FROM subscriptions
      WHERE user_guid = $1 AND status IN ('active', 'trialing', 'past_due')
      ORDER BY updated_at DESC
      LIMIT 1`,
    [userGuid],
  );

  const subscription = rows[0] || null;
  const active = !!subscription && (subscription.status === 'active' || subscription.status === 'trialing');
  return { active, subscription };
}
