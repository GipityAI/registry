/**
 * Secrets tab — CRUD for encrypted app/account secrets. Two scopes:
 *   • "This project" uses the global project picker's app_guid.
 *   • "Account-wide" is shared across all the user's projects (picker ignored).
 * Values are write-only — the API only ever returns names + masked previews.
 */
import { fmtTime, escapeHtml, emptyRow } from '../format.js';

const $ = (id) => document.getElementById(id);

let currentScope = 'project';
let currentAppGuid = '';
let bound = false;

const SCOPE_HINTS = {
  project: 'Available to this app only. A project secret overrides an account secret of the same name.',
  account: 'Shared across ALL your projects. Set a key like OPENAI_API_KEY once and every app inherits it.',
};

function openDialog() {
  $('secret-name').value = '';
  $('secret-value').value = '';
  $('secret-form-title').textContent = currentScope === 'account' ? 'New account-wide secret' : 'New project secret';
  $('secret-form-dialog').showModal();
}

function closeDialog() { $('secret-form-dialog').close(); }

async function submitForm(api, ev) {
  ev.preventDefault();
  const name = $('secret-name').value.trim();
  const value = $('secret-value').value;
  try {
    await api.setSecret(currentScope, currentAppGuid, name, value);
    closeDialog();
    await render(api);
  } catch (err) {
    alert(`Failed to save secret: ${err.message}`);
  }
}

async function deleteSecretFlow(api, name) {
  if (!confirm(`Delete secret "${name}"? Functions that read it will get null.`)) return;
  try {
    await api.deleteSecret(currentScope, currentAppGuid, name);
    await render(api);
  } catch (err) {
    alert(`Failed to delete secret: ${err.message}`);
  }
}

async function render(api) {
  $('secrets-scope-title').textContent = currentScope === 'account' ? 'Account-wide secrets' : 'Project secrets';
  $('secrets-scope-hint').textContent = SCOPE_HINTS[currentScope];
  const tbody = $('table-secrets').querySelector('tbody');
  const newBtn = $('new-secret-btn');

  // Project scope needs a specific app selected in the global picker.
  if (currentScope === 'project' && !currentAppGuid) {
    newBtn.disabled = true;
    tbody.innerHTML = emptyRow(4, 'Pick a project from the selector above to manage its secrets.');
    return;
  }
  newBtn.disabled = false;

  const res = await api.listSecrets(currentScope, currentAppGuid);
  const rows = res.data || [];
  if (!rows.length) {
    tbody.innerHTML = emptyRow(4, 'No secrets yet — click "+ New secret" to add one.');
    return;
  }
  tbody.innerHTML = rows.map((s) => `
    <tr data-name="${escapeHtml(s.name)}">
      <td><code>${escapeHtml(s.name)}</code></td>
      <td class="muted">${s.preview ? `…${escapeHtml(s.preview)}` : '<span class="muted">hidden</span>'}</td>
      <td class="muted">${fmtTime(s.updated_at)}</td>
      <td><button class="link-btn danger del-secret">Delete</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.del-secret').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      const name = ev.target.closest('tr').dataset.name;
      deleteSecretFlow(api, name);
    });
  });
}

export async function renderSecretsTab(api, filters) {
  currentAppGuid = filters?.appGuid || '';
  if (!bound) {
    bound = true;
    $('new-secret-btn').addEventListener('click', () => openDialog());
    $('secret-cancel').addEventListener('click', () => closeDialog());
    $('secret-form').addEventListener('submit', (ev) => submitForm(api, ev));
    document.querySelectorAll('[data-secret-scope]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentScope = btn.dataset.secretScope;
        document.querySelectorAll('[data-secret-scope]').forEach((b) =>
          b.classList.toggle('active', b === btn));
        render(api);
      });
    });
  }
  await render(api);
}
