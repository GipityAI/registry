/**
 * Alerts tab — CRUD for monitor_alerts. Same range/project picker as other
 * tabs is shown but ignored (alerts are global to the user). The dialog form
 * creates and edits a single alert.
 */
import { fmtNum, fmtUsd, fmtTime, escapeHtml, emptyRow } from '../format.js';

const $ = (id) => document.getElementById(id);

let cachedProjects = [];
let userEmailHint = '';
let bound = false;

const KIND_LABELS = {
  llm_spend: 'LLM spend',
  function_rate: 'Function calls',
  auth_failures: 'Auth failures',
  error_rate: 'App errors',
};

const KIND_HINTS = {
  llm_spend: 'USD over the window',
  function_rate: 'Function calls over the window',
  auth_failures: 'Failed login attempts over the window',
  error_rate: 'Total JS error occurrences over the window',
};

function fmtThreshold(kind, value) {
  const n = Number(value);
  return kind === 'llm_spend' ? fmtUsd(n) : fmtNum(n);
}

function fmtObserved(kind, value) {
  if (value == null) return '—';
  return kind === 'llm_spend' ? fmtUsd(Number(value)) : fmtNum(Number(value));
}

function fmtWindow(mins) {
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${(mins / 60).toFixed(mins % 60 === 0 ? 0 : 1)}h`;
  return `${(mins / 1440).toFixed(mins % 1440 === 0 ? 0 : 1)}d`;
}

function projectLabel(alert) {
  if (!alert.project_short_guid) return '<span class="muted">All projects</span>';
  return escapeHtml(alert.project_name || alert.project_short_guid);
}

function populateProjectSelect(sel) {
  sel.innerHTML = '<option value="">All projects</option>';
  for (const p of cachedProjects) {
    const opt = document.createElement('option');
    opt.value = p.short_guid;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
}

function openDialog(alert) {
  const dialog = $('alert-form-dialog');
  $('alert-form-title').textContent = alert ? 'Edit alert' : 'New alert';
  $('alert-id').value = alert ? alert.id : '';
  $('alert-kind').value = alert ? alert.kind : 'llm_spend';
  populateProjectSelect($('alert-project'));
  $('alert-project').value = alert?.project_short_guid || '';
  $('alert-threshold').value = alert ? Number(alert.threshold_numeric) : '';
  $('alert-window').value = alert ? alert.window_minutes : 60;
  $('alert-cooldown').value = alert ? alert.cooldown_minutes : 60;
  $('alert-email').value = alert?.email || userEmailHint || '';
  $('alert-active').checked = alert ? alert.is_active : true;
  $('alert-threshold-hint').textContent = KIND_HINTS[$('alert-kind').value];
  dialog.showModal();
}

function closeDialog() { $('alert-form-dialog').close(); }

async function deleteAlertFlow(api, id) {
  if (!confirm('Delete this alert? Fire history will also be removed.')) return;
  await api.deleteAlert(id);
  await render(api);
}

async function submitForm(api, ev) {
  ev.preventDefault();
  const id = $('alert-id').value || null;
  const payload = {
    kind: $('alert-kind').value,
    project_short_guid: $('alert-project').value || null,
    threshold_numeric: Number($('alert-threshold').value),
    window_minutes: Number($('alert-window').value),
    cooldown_minutes: Number($('alert-cooldown').value),
    email: $('alert-email').value,
    is_active: $('alert-active').checked,
  };
  try {
    if (id) {
      // Editing — don't send `kind` (immutable post-create).
      const { kind: _kind, ...rest } = payload;
      await api.updateAlert(id, rest);
    } else {
      await api.createAlert(payload);
    }
    closeDialog();
    await render(api);
  } catch (err) {
    alert(`Failed to save alert: ${err.message}`);
  }
}

async function render(api) {
  const [alertsRes, projectsRes] = await Promise.all([api.alerts(), api.projects()]);
  cachedProjects = projectsRes.data || [];
  const tbody = $('table-alerts').querySelector('tbody');
  if (!alertsRes.data.length) {
    tbody.innerHTML = emptyRow(9, 'No alerts yet — click "+ New alert" to create one.');
    return;
  }
  tbody.innerHTML = alertsRes.data.map((a) => `
    <tr data-id="${escapeHtml(a.id)}">
      <td>${escapeHtml(KIND_LABELS[a.kind] || a.kind)}</td>
      <td>${projectLabel(a)}</td>
      <td class="num">${fmtThreshold(a.kind, a.threshold_numeric)}</td>
      <td class="num">${fmtWindow(a.window_minutes)}</td>
      <td class="num">${fmtObserved(a.kind, a.last_observed)}</td>
      <td class="muted">${a.last_fired_at ? fmtTime(a.last_fired_at) : '—'}</td>
      <td>${a.is_active ? '<span class="pill ok">active</span>' : '<span class="pill muted">paused</span>'}</td>
      <td class="muted">${escapeHtml(a.email)}</td>
      <td>
        <button class="link-btn edit-alert">Edit</button>
        <button class="link-btn danger del-alert">Delete</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.edit-alert').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      const id = ev.target.closest('tr').dataset.id;
      const alert = alertsRes.data.find((x) => String(x.id) === String(id));
      if (alert) openDialog(alert);
    });
  });
  tbody.querySelectorAll('.del-alert').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      const id = ev.target.closest('tr').dataset.id;
      deleteAlertFlow(api, id);
    });
  });
}

async function loadDigestPref(api) {
  try {
    const res = await api.getDigestPref();
    $('digest-cadence').value = res.data.cadence || 'off';
    if (res.data.email) $('digest-email').value = res.data.email;
    else if (userEmailHint) $('digest-email').value = userEmailHint;
    if (res.data.last_sent_at) {
      $('digest-status').textContent = `Last sent ${new Date(res.data.last_sent_at).toLocaleString()}`;
    } else if (res.data.cadence && res.data.cadence !== 'off') {
      $('digest-status').textContent = 'Not yet sent';
    } else {
      $('digest-status').textContent = '';
    }
  } catch (err) {
    if (err.message !== 'UNAUTHENTICATED') console.error('[alerts] digest load failed', err);
  }
}

async function saveDigestPref(api, ev) {
  ev.preventDefault();
  const cadence = $('digest-cadence').value;
  const email = $('digest-email').value || userEmailHint;
  if (!email) { alert('Email required'); return; }
  try {
    await api.setDigestPref(cadence, email);
    $('digest-status').textContent = cadence === 'off' ? 'Digest disabled.' : `Digest saved — next email when due.`;
  } catch (err) {
    alert(`Save failed: ${err.message}`);
  }
}

export async function renderAlertsTab(api, _filters, { userEmail } = {}) {
  if (userEmail) userEmailHint = userEmail;
  if (!bound) {
    bound = true;
    $('new-alert-btn').addEventListener('click', () => openDialog(null));
    $('alert-cancel').addEventListener('click', () => closeDialog());
    $('alert-form').addEventListener('submit', (ev) => submitForm(api, ev));
    $('alert-kind').addEventListener('change', () => {
      $('alert-threshold-hint').textContent = KIND_HINTS[$('alert-kind').value];
    });
    $('digest-form').addEventListener('submit', (ev) => saveDigestPref(api, ev));
  }
  await Promise.all([render(api), loadDigestPref(api)]);
}
