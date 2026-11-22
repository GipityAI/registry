/**
 * Account tab: who you are, your sign-in passkeys (read here, managed on the
 * hosted page they link to; same route as `gipity account passkeys`), the API
 * tokens that act as you (gip_at_*, for headless agents and CI: listed and
 * revoked here, created only with `gipity token create`), and the NSFW opt-in.
 * Creating a token and deleting the account are CLI-only: Monitor's own-origin
 * access to the account (platform middleware/owner-app-host.ts) leaves them out.
 */
import { fmtExact, fmtTime, fmtFullTime, escapeHtml, emptyRow, safeHref } from '../format.js';

const $ = (id) => document.getElementById(id);
let bound = false;

function renderProfile(me) {
  $('acct-profile').innerHTML = `
    <tr><td class="muted">Email</td><td>${escapeHtml(me.email)}</td></tr>
    <tr><td class="muted">Account</td><td class="mono">${escapeHtml(me.accountSlug)}</td></tr>
    <tr><td class="muted">Name</td><td>${escapeHtml(me.displayName || '-')}</td></tr>
    <tr><td class="muted">Plan</td><td>${escapeHtml(me.subscriptionPlanName || me.subscriptionTier)}</td></tr>
    <tr><td class="muted">Projects</td><td>${fmtExact(me.stats?.projects ?? 0)}</td></tr>
    <tr><td class="muted">Member since</td><td title="${escapeHtml(fmtFullTime(me.createdAt))}">${fmtTime(me.createdAt)}</td></tr>`;
}

function renderTokens(tokens) {
  const body = $('table-acct-tokens').querySelector('tbody');
  if (!tokens.length) { body.innerHTML = emptyRow(5, 'No API tokens. Create one with gipity token create.'); return; }
  body.innerHTML = tokens.map((t) => `
    <tr>
      <td>${escapeHtml(t.name || '(unnamed)')} <span class="muted small mono">${escapeHtml(t.short_guid)}</span></td>
      <td class="muted">${fmtTime(t.created_at)}</td>
      <td class="muted">${t.last_used_at ? fmtTime(t.last_used_at) : 'never'}</td>
      <td class="muted">${t.expires_at ? fmtTime(t.expires_at) : 'never'}</td>
      <td class="row-actions"><button type="button" class="link-btn" data-revoke="${escapeHtml(t.short_guid)}">Revoke</button></td>
    </tr>`).join('');
}

async function refreshTokens(api) {
  renderTokens((await api.agentTokens()).data);
}

async function revoke(api, btn) {
  // Two clicks: the first arms it, the second revokes.
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Confirm revoke'; return; }
  btn.disabled = true;
  try {
    await api.revokeAgentToken(btn.dataset.revoke);
    await refreshTokens(api);
  } catch (err) {
    btn.textContent = err.message;
  }
}

function renderPasskeys(state) {
  $('acct-passkeys-state').textContent = state.requirePasskey
    ? 'Require passkey: on. A passkey is needed to sign in.'
    : state.passkeys.length
      ? 'Require passkey: off. A passkey or an email code signs in.'
      : 'No sign-in passkeys yet. You sign in with an email code.';
  $('acct-passkeys-manage').href = safeHref(state.manageUrl);
  const body = $('table-acct-passkeys').querySelector('tbody');
  if (!state.passkeys.length) { body.innerHTML = emptyRow(4, 'No sign-in passkeys.'); return; }
  body.innerHTML = state.passkeys.map((p) => `
    <tr>
      <td>${escapeHtml(p.label || 'Passkey')}</td>
      <td class="mono small">${escapeHtml(p.fingerprint)}</td>
      <td class="muted">${fmtTime(p.createdAt)}</td>
      <td class="muted">${p.lastUsedAt ? fmtTime(p.lastUsedAt) : 'never'}</td>
    </tr>`).join('');
}

// NSFW services opt-in. Self-serve can be closed (terms not live yet): then the
// switch is shown but disabled, and an account turned on by an admin can still
// turn it off.
let nsfwOn = false;
function renderNsfw(state) {
  nsfwOn = state.allow_nsfw_services;
  const closed = !nsfwOn && !state.self_serve_open;
  $('acct-nsfw-state').textContent = nsfwOn
    ? `On${state.nsfw_attested_at ? ` (terms accepted ${state.nsfw_attested_at.slice(0, 10)})` : ''}.`
    : closed ? 'Off. Not open yet.' : 'Off.';
  $('acct-nsfw-attest-label').hidden = nsfwOn || closed;
  $('acct-nsfw-btn').hidden = closed;
  $('acct-nsfw-btn').textContent = nsfwOn ? 'Turn off' : 'Turn on';
  $('acct-nsfw-btn').className = nsfwOn ? 'link-btn' : 'primary-btn';
}

async function toggleNsfw(api, ev) {
  ev.preventDefault();
  $('acct-nsfw-status').textContent = '';
  const attest = $('acct-nsfw-attest').checked;
  if (!nsfwOn && !attest) { $('acct-nsfw-status').textContent = 'Tick the box to accept the terms first.'; return; }
  $('acct-nsfw-btn').disabled = true;
  try {
    renderNsfw((await api.setNsfw(!nsfwOn, nsfwOn ? undefined : true)).data);
    $('acct-nsfw-attest').checked = false;
  } catch (err) {
    $('acct-nsfw-status').textContent = err.message;
  } finally {
    $('acct-nsfw-btn').disabled = false;
  }
}

export async function renderAccountTab(api) {
  if (!bound) {
    bound = true;
    $('table-acct-tokens').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-revoke]');
      if (btn) revoke(api, btn);
    });
    $('acct-nsfw-form').addEventListener('submit', (ev) => toggleNsfw(api, ev));
  }
  const [me, tokens, nsfw, passkeys] = await Promise.all([api.me(), api.agentTokens(), api.nsfw(), api.signinPasskeys()]);
  renderProfile(me.data);
  renderPasskeys(passkeys.data);
  renderTokens(tokens.data);
  renderNsfw(nsfw.data);
}
