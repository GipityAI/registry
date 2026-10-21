# @gipity/stripe

Charge your app's end-users for **one-time purchases** and **subscriptions** via Stripe — with Gipity-hosted onboarding, signature-verified webhooks, and a small platform fee handled for you.

How the money flows: the app owner connects **their own** Stripe account (Stripe Connect Express). Customers pay on Stripe's hosted Checkout; money lands in the owner's account. Gipity takes a configurable platform fee (default 1%) on top of Stripe's processing fees. The owner is the merchant of record.

Why part of this is platform-side: an app's serverless functions can't safely verify Stripe webhooks (no raw body, no crypto in the sandbox). So the **platform** calls Stripe with your connected account and verifies every webhook, then forwards the trusted event to this kit's `payment-events` function for fulfillment.

## Setup (owner, once)

```bash
gipity payments connect   # opens Stripe onboarding (bank + identity; no API keys to paste)
gipity payments status    # confirm "charges enabled"
```

## Use it

```js
import { checkout, getSubscriptionStatus, openBillingPortal } from '@gipity/stripe';

// One-time purchase ($49.00). Amounts are in the currency's smallest unit (cents).
checkout({ items: [{ name: 'Lifetime access', amount: 4900 }] });

// Monthly subscription ($9.00/mo).
checkout({ mode: 'subscription', items: [{ name: 'Pro', amount: 900, interval: 'month' }] });

// Gate members-only UI.
const { active } = await getSubscriptionStatus();
if (active) showProFeatures();

// Let a subscriber manage or cancel billing (Stripe Customer Portal).
openBillingPortal();
```

Or drop in the element (no JS wiring needed):

```html
<stripe-buy-button name="Lifetime access" amount="4900">Buy</stripe-buy-button>
<stripe-buy-button name="Pro" amount="900" mode="subscription" interval="month">Subscribe</stripe-buy-button>
<stripe-buy-button price-id="price_123" mode="subscription">Subscribe</stripe-buy-button>
```

The platform attributes each purchase and subscription to the signed-in Gipity user who checks out (it stamps their guid on the Stripe session itself, so a browser can't name someone else), and that is what `getSubscriptionStatus()` reads. `openBillingPortal()` works only for that signed-in buyer: the platform refuses to open a portal for a customer whose subscription the caller didn't buy. A signed-out purchase is attributed to no one, so ask users to sign in before subscribing. Pass `{ redirect: false }` to get `{ checkoutUrl }` back instead of navigating.

## What it ships

- **Frontend** (`@gipity/stripe`): `checkout()`, `getSubscriptionStatus()`, `openBillingPortal()`, and the `<stripe-buy-button>` element.
- **Functions**: `payment-events` (`auth: member`, and it refuses any call the platform didn't trigger with a verified Stripe event, so HTTP callers can't reach it; records to the tables below) and `payment-status` (user: the gating read).
- **Tables**: `payments` (one row per completed checkout, idempotent on `stripe_session_id`) and `subscriptions` (one row per Stripe subscription, upserted across its lifecycle).

The `payment-events` function is kit-owned (sealed): re-`add` the kit at a newer version to upgrade it. Your own fulfillment logic (grant a role, send an email) belongs in your app code, triggered off the `payments`/`subscriptions` rows.

## Notes

- Inline `{ name, amount }` items need no pre-created Stripe products. You can also pass a Stripe `{ priceId }`.
- `interval` is required on each item for subscription mode (`day`/`week`/`month`/`year`).
- There is no Stripe test mode yet: test with a real low-value purchase on the prod URL and refund it from your Stripe dashboard.
- Needs a database — install into a `web-fullstack` or `api` app.
