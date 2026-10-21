# Paid app (Stripe)

A working storefront that charges real money: a **one-time purchase**, a **monthly subscription**, a **members-only area** gated on subscription status, and a **Manage billing** link to the Stripe Customer Portal. Built on `web-fullstack` with the [`@gipity/stripe`](../../kits/stripe/README.md) kit pre-installed.

## One-time setup (you, the owner)

Connect your Stripe account so payments land in it:

```bash
gipity payments connect    # Stripe-hosted onboarding (bank + identity; no API keys)
gipity payments status     # confirm "charges enabled"
gipity deploy prod         # payments run in prod only (refused in environments)
```

Money goes to **your** Stripe account. Gipity takes a small platform fee (default 1%) on top of Stripe's processing fees. There is no Stripe test mode yet: test with a real low-value purchase on the prod URL and refund it from your Stripe dashboard.

## What's wired

- **`src/index.html`** — pricing cards using `<stripe-buy-button>` (one-time + subscription) and a hidden members area.
- **`src/js/main.js`** — sign-in/out, the post-checkout banner, subscription gating via `getSubscriptionStatus()`, and the billing portal.
- **`functions/payment-events`** — fulfillment: the platform calls it with signature-verified Stripe events; it records to `payments` / `subscriptions`. (Kit-owned — don't edit.)
- **`functions/payment-status`** — the gating read (is this signed-in user subscribed?).
- **`migrations/000-kit-stripe-core.sql`** — the `payments` and `subscriptions` tables.

## Make it yours

- Change prices/labels in the `<stripe-buy-button>` elements in `index.html` (amounts are in cents).
- Put your real premium features inside the `#members` section.
- Grant access / send a receipt by reacting to new rows in `payments` / `subscriptions` from your own function or workflow — keep the kit's `payment-events` sealed.

Subscriptions are attributed to the **signed-in** Gipity user, so encourage users to sign in before subscribing (the page's "Sign in" control does this).
