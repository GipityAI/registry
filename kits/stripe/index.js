/**
 * @gipity/stripe — charge your app's end-users via Stripe.
 *
 * The platform brokers the security-critical parts (it calls Stripe with the
 * owner's connected account and verifies webhooks); this module is the thin
 * browser layer. It talks to the `payments` app service via `Gipity.service(...)`
 * and to the kit's fulfillment-backed read function via `Gipity.fn(...)`.
 *
 * One-time setup (owner, once): `gipity payments connect` → finish Stripe
 * onboarding → `gipity payments status` shows charges enabled.
 *
 * Usage:
 *   import { checkout, getSubscriptionStatus, openBillingPortal } from '@gipity/stripe';
 *
 *   // one-time purchase
 *   checkout({ items: [{ name: 'Lifetime access', amount: 4900 }] });
 *
 *   // monthly subscription
 *   checkout({ mode: 'subscription', items: [{ name: 'Pro', amount: 900, interval: 'month' }] });
 *
 *   // gate UI
 *   const { active } = await getSubscriptionStatus();
 *   if (active) showProFeatures();
 *
 *   // let a subscriber manage/cancel billing
 *   openBillingPortal();
 *
 * Or drop in the <stripe-buy-button> element (see defineBuyButton, auto-called on import).
 */

const G = () => {
  if (typeof window === 'undefined' || !window.Gipity) {
    throw new Error('@gipity/stripe needs the Gipity client SDK. Ensure the gipity.js <script data-app="..."> tag is present.');
  }
  return window.Gipity;
};

/** Best-effort current Gipity user (for attributing purchases); null if signed out. */
async function currentUser() {
  try {
    const u = await G().auth.user();
    return u || null;
  } catch {
    return null;
  }
}

function userGuidOf(u) {
  return u ? (u.guid || u.shortGuid || u.userGuid || null) : null;
}

/**
 * Start a Stripe Checkout. Redirects to Stripe's hosted page by default.
 *
 * @param {object} opts
 * @param {'payment'|'subscription'} [opts.mode='payment']
 * @param {Array<{priceId?:string,name?:string,amount?:number,currency?:string,interval?:'day'|'week'|'month'|'year',quantity?:number}>} opts.items
 * @param {string} [opts.successUrl]  defaults to current URL with ?checkout=success
 * @param {string} [opts.cancelUrl]   defaults to current URL with ?checkout=cancel
 * @param {object} [opts.metadata]
 * @param {boolean} [opts.redirect=true]  when false, returns { checkoutUrl } instead of navigating
 * @returns {Promise<{checkoutUrl:string, sessionId:string}|void>}
 */
export async function checkout(opts) {
  if (!opts || !Array.isArray(opts.items) || opts.items.length === 0) {
    throw new Error('checkout({ items: [...] }) requires at least one item');
  }
  const here = (typeof location !== 'undefined') ? location.href.split('?')[0] : '';
  const mode = opts.mode || 'payment';
  const user = await currentUser();
  const guid = userGuidOf(user);

  const body = {
    mode,
    items: opts.items,
    successUrl: opts.successUrl || `${here}?checkout=success`,
    cancelUrl: opts.cancelUrl || `${here}?checkout=cancel`,
    ...(guid ? { clientReferenceId: guid } : {}),
    ...(user && user.email ? { customerEmail: user.email } : {}),
    metadata: { ...(opts.metadata || {}), ...(guid ? { gipity_user_guid: guid } : {}) },
  };

  const res = await G().service('payments/checkout', body);
  if (opts.redirect === false) return res;
  location.href = res.checkoutUrl;
}

/**
 * Subscription status for the signed-in user, for gating UI.
 * @returns {Promise<{active:boolean, subscription:object|null}>}
 */
export async function getSubscriptionStatus() {
  return G().fn('payment-status');
}

/**
 * Open the Stripe Customer Portal so a subscriber can update payment method or
 * cancel. Looks up the caller's Stripe customer from their subscription.
 * @param {object} [opts]
 * @param {string} [opts.returnUrl] where Stripe returns the user (default: current URL)
 */
export async function openBillingPortal(opts) {
  opts = opts || {};
  const { subscription } = await getSubscriptionStatus();
  const customerId = subscription && subscription.stripe_customer_id;
  if (!customerId) throw new Error('No active subscription to manage.');
  const returnUrl = opts.returnUrl || (typeof location !== 'undefined' ? location.href : '');
  const res = await G().service('payments/portal', { customerId, returnUrl });
  location.href = res.portalUrl;
}

/**
 * Register the <stripe-buy-button> custom element. Idempotent; auto-called on import.
 *
 * <stripe-buy-button name="Lifetime access" amount="4900">Buy</stripe-buy-button>
 * <stripe-buy-button name="Pro" amount="900" mode="subscription" interval="month">Subscribe</stripe-buy-button>
 * <stripe-buy-button price-id="price_123" mode="subscription">Subscribe</stripe-buy-button>
 */
export function defineBuyButton() {
  if (typeof window === 'undefined' || typeof HTMLElement === 'undefined') return;
  if (customElements.get('stripe-buy-button')) return;

  class StripeBuyButton extends HTMLElement {
    connectedCallback() {
      if (this._wired) return;
      this._wired = true;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = this.textContent.trim() || 'Buy';
      btn.className = this.getAttribute('button-class') || '';
      this.textContent = '';
      this.appendChild(btn);
      btn.addEventListener('click', () => this.buy(btn));
    }

    async buy(btn) {
      const mode = this.getAttribute('mode') || 'payment';
      const priceId = this.getAttribute('price-id');
      const amount = this.getAttribute('amount');
      const item = priceId
        ? { priceId }
        : {
            name: this.getAttribute('name') || 'Purchase',
            amount: amount ? parseInt(amount, 10) : undefined,
            currency: this.getAttribute('currency') || undefined,
            interval: this.getAttribute('interval') || undefined,
          };
      const prev = btn.textContent;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        await checkout({
          mode,
          items: [item],
          successUrl: this.getAttribute('success-url') || undefined,
          cancelUrl: this.getAttribute('cancel-url') || undefined,
        });
      } catch (err) {
        btn.disabled = false;
        btn.textContent = prev;
        this.dispatchEvent(new CustomEvent('stripe-error', { detail: err, bubbles: true }));
        throw err;
      }
    }
  }

  customElements.define('stripe-buy-button', StripeBuyButton);
}

defineBuyButton();

export default { checkout, getSubscriptionStatus, openBillingPortal, defineBuyButton };
