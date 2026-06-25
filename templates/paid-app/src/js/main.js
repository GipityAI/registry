// Storefront wiring: account state, post-checkout flash, subscription gating,
// and the billing portal. The <stripe-buy-button> elements in index.html wire
// themselves up the moment @gipity/stripe is imported below.
import { getSubscriptionStatus, openBillingPortal } from '@gipity/stripe';
import { config } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
  showCheckoutFlash();
  renderAccount();
  refreshGating();

  const manage = document.getElementById('manage-billing');
  manage?.addEventListener('click', async () => {
    manage.disabled = true;
    try {
      await openBillingPortal();
    } catch (err) {
      manage.disabled = false;
      alert(err.message || 'Could not open the billing portal.');
    }
  });
});

/** Banner reflecting Stripe's redirect back to ?checkout=success|cancel. */
function showCheckoutFlash() {
  const flash = document.getElementById('flash');
  if (!flash) return;
  const state = new URLSearchParams(location.search).get('checkout');
  if (state === 'success') {
    flash.textContent = '✓ Payment complete — thank you! Your purchase is being confirmed.';
    flash.className = 'flash ok';
    flash.hidden = false;
    // Give the webhook a moment to land, then re-check gating.
    setTimeout(refreshGating, 2500);
  } else if (state === 'cancel') {
    flash.textContent = 'Checkout cancelled — no charge was made.';
    flash.className = 'flash';
    flash.hidden = false;
  }
}

/** Sign-in / sign-out control. Purchases are attributed to the signed-in user,
 *  which is what subscription gating reads, so signing in matters for Pro. */
async function renderAccount() {
  const el = document.getElementById('account');
  if (!el || !window.Gipity) return;
  let user = null;
  try { user = await window.Gipity.auth.user(); } catch { /* signed out */ }

  if (user) {
    const name = user.displayName || user.email || 'Account';
    el.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = name;
    const out = document.createElement('button');
    out.type = 'button';
    out.textContent = 'Sign out';
    out.addEventListener('click', () => window.Gipity.auth.signOut().then(() => location.reload()));
    el.append(span, out);
  } else {
    el.innerHTML = '';
    const inBtn = document.createElement('button');
    inBtn.type = 'button';
    inBtn.textContent = 'Sign in';
    inBtn.addEventListener('click', () => window.Gipity.auth.signIn().then(() => location.reload()));
    el.appendChild(inBtn);
  }
}

/** Reveal the members area when the signed-in user has an active subscription. */
async function refreshGating() {
  const members = document.getElementById('members');
  if (!members) return;
  try {
    const { active } = await getSubscriptionStatus();
    members.hidden = !active;
  } catch {
    members.hidden = true; // not signed in (auth: user) → no Pro access
  }
}

void config;
