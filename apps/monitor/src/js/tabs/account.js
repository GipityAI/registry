/**
 * Account tab: who you are, the API tokens that act as you (gip_at_*, for
 * headless agents and CI), and deleting the account. The same routes as
 * `gipity token create / list / revoke`.
 */
import { fmtExact, fmtTime, fmtFullTime, escapeHtml, emptyRow } from '../format.js';

const $ = (id) => document.getElementById(id);
let bound = false;
let accountSlug = '';

function renderProfile(me) {
  accountSlug = me.accountSlug;
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
  if (!tokens.length) { body.innerHTML = emptyRow(5, 'No API tokens. Create one for a headless agent or CI job.'); return; }
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

async function createToken(api, ev) {
  ev.preventDefault();
  const name = $('acct-token-name').value.trim() || undefined;
  const days = Number($('acct-token-days').value) || undefined;
  $('acct-token-status').textContent = '';
  try {
    const { token } = (await api.createAgentToken(name, days)).data;
    $('acct-token-value').textContent = token;
    $('acct-token-new').hidden = false;
    $('acct-token-form').reset();
    await refreshTokens(api);
  } catch (err) {
    $('acct-token-status').textContent = err.message;
  }
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

async function deleteAccount(api, ev) {
  ev.preventDefault();
  if ($('acct-delete-confirm').value.trim() !== accountSlug) {
    $('acct-delete-status').textContent = `Type ${accountSlug} to confirm.`;
    return;
  }
  $('acct-delete-btn').disabled = true;
  try {
    await api.deleteAccount();
    // Reuse the sign-in gate as the goodbye screen.
    const gate = $('auth-gate');
    gate.querySelector('h2').textContent = 'Account deleted';
    gate.querySelector('.gate-lede').textContent = 'Your projects, files, databases and data have been removed. You can close this page.';
    $('signin').hidden = true;
    $('dashboard').hidden = true;
    gate.hidden = false;
  } catch (err) {
    $('acct-delete-btn').disabled = false;
    $('acct-delete-status').textContent = err.message;
  }
}

export async function renderAccountTab(api) {
  if (!bound) {
    bound = true;
    $('acct-token-form').addEventListener('submit', (ev) => createToken(api, ev));
    $('acct-token-copy').addEventListener('click', () => navigator.clipboard?.writeText($('acct-token-value').textContent));
    $('table-acct-tokens').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-revoke]');
      if (btn) revoke(api, btn);
    });
    $('acct-delete-form').addEventListener('submit', (ev) => deleteAccount(api, ev));
    $('acct-nsfw-form').addEventListener('submit', (ev) => toggleNsfw(api, ev));
  }
  const [me, tokens, nsfw] = await Promise.all([api.me(), api.agentTokens(), api.nsfw()]);
  renderProfile(me.data);
  renderTokens(tokens.data);
  renderNsfw(nsfw.data);
}
