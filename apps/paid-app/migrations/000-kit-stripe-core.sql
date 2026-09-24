-- Stripe payments kit: fulfillment tables, written by the `payment-events`
-- function when the platform forwards a signature-verified Stripe webhook.
-- Sorts before app migrations via the 000- prefix.

-- One row per completed checkout (one-time purchase OR subscription start).
-- `stripe_session_id` is UNIQUE so webhook replays are idempotent.
CREATE TABLE IF NOT EXISTS payments (
    id                   VARCHAR(20) PRIMARY KEY,        -- app-generated short guid (pay_…)
    stripe_session_id    VARCHAR(120) NOT NULL UNIQUE,   -- cs_…
    stripe_customer_id   VARCHAR(120),                   -- cus_…
    user_guid            VARCHAR(40),                    -- the buying Gipity user, if signed in
    mode                 VARCHAR(20) NOT NULL,           -- payment | subscription
    amount_total         INTEGER,                        -- in the currency's smallest unit (cents)
    currency             VARCHAR(10),
    status               VARCHAR(30) NOT NULL DEFAULT 'paid',
    email                VARCHAR(200),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_guid);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);

-- One row per Stripe subscription. `stripe_subscription_id` is the natural key;
-- the row is upserted as the subscription's lifecycle events arrive.
CREATE TABLE IF NOT EXISTS subscriptions (
    stripe_subscription_id VARCHAR(120) PRIMARY KEY,     -- sub_…
    stripe_customer_id     VARCHAR(120),                 -- cus_…  (used for the billing portal)
    user_guid              VARCHAR(40),                  -- the subscribed Gipity user, if signed in
    status                 VARCHAR(30) NOT NULL,         -- active | trialing | past_due | canceled | …
    price_id               VARCHAR(120),
    current_period_end     TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_guid);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(stripe_customer_id);
