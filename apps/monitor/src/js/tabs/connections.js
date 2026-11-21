/**
 * AI connections tab: for the project in the global picker and one of its
 * environments (prod by default; `#connections/<env>` deep-links one), the
 * keys people made in the app for their own AI and the chat apps they
 * connected through its MCP server, with per-function call counts and an owner
 * revoke; plus the environment's MCP server and key profiles, read only.
 * Same routes as `gipity key list --user-keys`, `gipity key revoke`,
 * `gipity mcp` and `gipity key profiles`.
 */
import { fmtExact, fmtTime, fmtUntil, fmtFullTime, escapeHtml, emptyState } from '../format.js';
import { hashPath, setHashPath, requestRender } from '../ui.js';

const $ = (id) => document.getElementById(id);

let bound = false;
/** The environment guid the table's revoke buttons act on. */
let currentGuid = '';
/** The rows on screen, by key guid, for the expand rows. */
let rowsByGuid = new Map();

const PROVIDERS = { guest: 'Guest', steam: 'Steam', google: 'Google', discord: 'Discord', apple: 'Apple', email: 'Email' };
const SKILL_CMD = 'gipity skill read app-agents';

/** "Claude (claude.ai)" -> "Claude": the consent page's shortClientName. */
function shortClientName(name) {
  const short = name.replace(/\s*\([^()]*\)\s*$/, '').trim();
  return short || name.trim();
}

/** Who made a key: their display name, else what kind of person they are.
 *  The API never sends an email or a DB id. */
function whoLabel(k) {
  if (k.created_by_name) return k.created_by_name;
  if (k.created_by_kind === 'app_user') return `${PROVIDERS[k.created_by_provider] || 'App'} user`;
  return 'Gipity account';
}

function whoKind(k) {
  return k.created_by_kind === 'app_user' ? 'app user' : 'Gipity account';
}

/** prod, then each environment, from the picker's project. */
function targetsFor(project) {
  return [{ name: 'prod', guid: project.short_guid }, ...(project.envs || []).map((e) => ({ name: e.name, guid: e.guid }))];
}

function renderEnvStrip(targets, active) {
  const strip = $('conn-envs');
  strip.hidden = targets.length < 2;
  strip.innerHTML = targets.map((t) =>
    `<button type="button" data-conn-env="${escapeHtml(t.name)}" class="${t.name === active ? 'active' : ''}">${escapeHtml(t.name)}</button>`).join('');
}

function kindCell(k) {
  if (k.oauth_client) {
    return `<div><span class="pill info">Chat app</span> ${escapeHtml(shortClientName(k.oauth_client))}</div>`;
  }
  return `<div><span class="pill muted">Key</span><div class="muted">${escapeHtml(k.name)}</div></div>`;
}

function renderConnections(keys) {
  const body = $('table-conn').querySelector('tbody');
  rowsByGuid = new Map(keys.map((k) => [k.short_guid, k]));
  if (!keys.length) {
    body.innerHTML = emptyState(8, { icon: '◌', message: 'No AI connections yet. People make a key or connect a chat app from inside your app.', tryit: SKILL_CMD });
    return;
  }
  body.innerHTML = keys.map((k) => `
    <tr class="expand-row" data-key="${escapeHtml(k.short_guid)}" aria-expanded="false">
      <td data-label="Who"><div class="expand-who"><span class="caret" aria-hidden="true">▸</span><div><div>${escapeHtml(whoLabel(k))}</div><div class="muted">${escapeHtml(whoKind(k))} · ${escapeHtml(k.created_by_guid || '-')}</div></div></div></td>
      <td data-label="Kind">${kindCell(k)}</td>
      <td data-label="Profile"><code>${escapeHtml(k.profile)}</code></td>
      <td data-label="Created" class="muted" title="${escapeHtml(fmtFullTime(k.created_at))}">${fmtTime(k.created_at)}</td>
      <td data-label="Last used" class="muted" title="${escapeHtml(fmtFullTime(k.last_used_at))}">${k.last_used_at ? fmtTime(k.last_used_at) : 'never'}</td>
      <td data-label="Expires" class="muted" title="${escapeHtml(fmtFullTime(k.expires_at))}">${fmtUntil(k.expires_at)}</td>
      <td data-label="Calls" class="num">${fmtExact(k.use_count)}</td>
      <td class="row-actions"><button type="button" class="link-btn danger" data-revoke="${escapeHtml(k.short_guid)}">Revoke</button></td>
    </tr>`).join('');
}

/** The expanded row: what the key may call and what it has called. */
function detailHtml(k) {
  const calls = k.function_calls || [];
  const allowed = `<p class="muted small">Can call: <code>${escapeHtml((k.functions || []).join(', ') || '-')}</code></p>`;
  if (!calls.length) return `${allowed}<p class="muted small">No function calls recorded yet.</p>`;
  return `${allowed}
    <table class="data-table compact stack-table">
      <thead><tr><th>Function</th><th class="num">Calls</th><th class="num">Refused</th><th>Last status</th><th>Last call</th></tr></thead>
      <tbody>${calls.map((c) => `
        <tr>
          <td data-label="Function"><code>${escapeHtml(c.name)}</code></td>
          <td data-label="Calls" class="num">${fmtExact(c.calls)}</td>
          <td data-label="Refused" class="num">${c.refused ? `<span class="pill warn">${fmtExact(c.refused)}</span>` : '0'}</td>
          <td data-label="Last status">${c.last_status === 'ok' ? '<span class="pill ok">ok</span>' : `<span class="pill error">${escapeHtml(c.last_status)}</span>`}</td>
          <td data-label="Last call" class="muted" title="${escapeHtml(fmtFullTime(c.last_called_at))}">${fmtTime(c.last_called_at)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function toggleRow(row) {
  const next = row.nextElementSibling;
  if (next && next.classList.contains('expand-detail-row')) {
    next.remove();
    row.classList.remove('expanded');
    row.setAttribute('aria-expanded', 'false');
    return;
  }
  const k = rowsByGuid.get(row.dataset.key);
  if (!k) return;
  const tr = document.createElement('tr');
  tr.className = 'expand-detail-row';
  const td = document.createElement('td');
  td.colSpan = 8;
  td.innerHTML = detailHtml(k);
  tr.appendChild(td);
  row.after(tr);
  row.classList.add('expanded');
  row.setAttribute('aria-expanded', 'true');
}

async function revoke(api, btn) {
  // Two clicks: the first arms it, the second revokes.
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Confirm revoke'; return; }
  btn.disabled = true;
  try {
    await api.revokeKey(currentGuid, btn.dataset.revoke);
    requestRender();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = err.message;
  }
}

function renderMcp(m) {
  const el = $('conn-mcp');
  if (m.on) {
    const tools = m.tools || [];
    el.innerHTML = `
      <p><span class="pill ok">On</span> ${escapeHtml(m.name || '')}</p>
      <p class="small">People connect Claude or ChatGPT with this URL and sign in. No key to paste.</p>
      <p><button type="button" class="copy-chip conn-url" data-copy="${escapeHtml(m.url)}" title="Copy URL"><code>${escapeHtml(m.url)}</code></button></p>
      <p class="muted small">Profile <code>${escapeHtml(m.profile)}</code> · ${fmtExact(tools.length)} ${tools.length === 1 ? 'tool' : 'tools'}${tools.length ? `: ${escapeHtml(tools.map((t) => t.name).join(', '))}` : ''}</p>`;
    return;
  }
  const why = m.profile
    ? `The <code>mcp:</code> block names the profile <code>${escapeHtml(m.profile)}</code>, which is not in <code>key_profiles:</code>.`
    : 'Chat apps can\'t connect yet. Add an <code>mcp:</code> block to gipity.yaml and deploy.';
  el.innerHTML = `
    <p><span class="pill muted">Off</span></p>
    <p class="small">${why} The app-agents skill shows how.</p>
    <p><button type="button" class="copy-chip" data-copy="${SKILL_CMD}" title="Copy command"><code>$ ${SKILL_CMD}</code></button></p>`;
}

function renderProfiles(profiles) {
  const body = $('table-conn-profiles').querySelector('tbody');
  if (!profiles.length) {
    body.innerHTML = emptyState(3, { icon: '◌', message: 'No key profiles, so people can\'t make keys or connect chat apps. Declare <code>key_profiles:</code> in gipity.yaml; the app-agents skill shows how.', tryit: SKILL_CMD });
    return;
  }
  body.innerHTML = profiles.map((p) => `
    <tr>
      <td data-label="Profile"><div><div><code>${escapeHtml(p.name)}</code></div>${p.summary ? `<div class="muted">${escapeHtml(p.summary)}</div>` : ''}</div></td>
      <td data-label="Functions">${escapeHtml(p.functions.join(', '))}</td>
      <td data-label="Max days" class="num">${fmtExact(p.max_days)}</td>
    </tr>`).join('');
}

function bind(api) {
  bound = true;
  $('conn-envs').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-conn-env]');
    if (!btn) return;
    setHashPath(`connections/${btn.dataset.connEnv}`);
    requestRender();
  });
  $('table-conn').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-revoke]');
    if (btn) { revoke(api, btn); return; }
    const row = ev.target.closest('tr.expand-row');
    if (row) toggleRow(row);
  });
}

export async function renderConnectionsTab(api, filters) {
  if (!bound) bind(api);
  const appGuid = filters?.appGuid || '';
  $('conn-pick').hidden = !!appGuid;
  $('conn-body').hidden = !appGuid;
  if (!appGuid) { $('conn-envs').hidden = true; return; }

  const project = (await api.projects()).data.find((p) => p.short_guid === appGuid);
  if (!project) throw new Error('Project not found');
  const targets = targetsFor(project);
  const wanted = hashPath().split('/')[1];
  const target = targets.find((t) => t.name === wanted) || targets[0];
  renderEnvStrip(targets, target.name);
  currentGuid = target.guid;

  const [keys, mcp, profiles] = await Promise.all([
    api.userKeys(target.guid), api.mcpStatus(target.guid), api.keyProfiles(target.guid),
  ]);
  if (currentGuid !== target.guid) return; // a newer render took over
  const rows = keys.data;
  $('conn-count').textContent = fmtExact(rows.length);
  $('conn-chat').textContent = fmtExact(rows.filter((k) => k.oauth_client).length);
  $('conn-people').textContent = fmtExact(new Set(rows.map((k) => k.created_by_guid)).size);
  $('conn-calls').textContent = fmtExact(rows.reduce((n, k) => n + (k.use_count || 0), 0));
  renderConnections(rows);
  renderMcp(mcp.data);
  renderProfiles(profiles.data.profiles);
}
