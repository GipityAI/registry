/**
 * Devices tab — local agents (Claude Code, Codex) paired to this account.
 * Shows the device list (revoked vs active), recent dispatches sent from the
 * web CLI `cc>` mode, and recent remote-driven conversations.
 */
import { fmtExact, fmtTime, escapeHtml, emptyRow, truncate } from '../format.js';

const $ = (id) => document.getElementById(id);

function dispatchStatusPill(status) {
  switch (status) {
    case 'done':       return '<span class="pill ok">done</span>';
    case 'delivering': return '<span class="pill info">delivering</span>';
    case 'pending':    return '<span class="pill warn">pending</span>';
    case 'cancelled':  return '<span class="pill muted">cancelled</span>';
    case 'error':      return '<span class="pill error">error</span>';
    default:           return `<span class="pill muted">${escapeHtml(status)}</span>`;
  }
}

export async function renderDevicesTab(api, { range, appGuid }) {
  const res = await api.remote(range, appGuid);
  const { summary, devices, dispatches, sessions } = res.data;

  $('rmt-devices').textContent = fmtExact(summary.active_devices);
  $('rmt-dispatches').textContent = fmtExact(summary.dispatches);
  $('rmt-pending').innerHTML = summary.pending_dispatches > 0
    ? `<span class="pill warn">${fmtExact(summary.pending_dispatches)}</span>`
    : '0';
  $('rmt-sessions').textContent = fmtExact(summary.sessions);

  const dBody = $('table-rmt-devices').querySelector('tbody');
  if (!devices.length) {
    dBody.innerHTML = emptyRow(5, 'No paired devices yet — run <code>gipity claude</code> on your laptop to pair.');
  } else {
    dBody.innerHTML = devices.map((d) => {
      const state = d.revoked_at
        ? '<span class="pill muted">revoked</span>'
        : (d.last_seen_at && (Date.now() - new Date(d.last_seen_at).getTime()) < 5 * 60_000)
          ? '<span class="pill ok">online</span>'
          : '<span class="pill info">idle</span>';
      return `
        <tr>
          <td class="mono">${escapeHtml(d.name)}</td>
          <td class="muted">${escapeHtml(d.platform)}</td>
          <td>${state}</td>
          <td class="muted">${d.last_seen_at ? fmtTime(d.last_seen_at) : '—'}</td>
          <td class="muted">${fmtTime(d.paired_at)}</td>
        </tr>
      `;
    }).join('');
  }

  const xBody = $('table-rmt-dispatches').querySelector('tbody');
  if (!dispatches.length) {
    xBody.innerHTML = emptyRow(6, 'No dispatches in this window.');
  } else {
    xBody.innerHTML = dispatches.map((x) => `
      <tr>
        <td class="muted">${fmtTime(x.created_at)}</td>
        <td class="mono">${escapeHtml(x.device_name || '—')}</td>
        <td class="muted">${escapeHtml(x.project_name || x.project_short_guid || '—')}</td>
        <td class="muted">${escapeHtml(x.kind)}</td>
        <td>${dispatchStatusPill(x.status)}</td>
        <td class="mono">${escapeHtml(truncate(x.message, 120))}</td>
      </tr>
    `).join('');
  }

  const sBody = $('table-rmt-sessions').querySelector('tbody');
  if (!sessions.length) {
    sBody.innerHTML = emptyRow(6, 'No remote sessions in this window.');
  } else {
    sBody.innerHTML = sessions.map((s) => `
      <tr>
        <td class="muted">${fmtTime(s.created_at)}</td>
        <td class="mono">${escapeHtml(s.title || '—')}</td>
        <td class="muted">${escapeHtml(s.source)}</td>
        <td class="muted">${escapeHtml(s.project_name || s.project_short_guid || '—')}</td>
        <td class="mono muted">${escapeHtml(truncate(s.cwd || '', 60))}</td>
        <td>${s.ended_at ? '<span class="pill muted">ended</span>' : '<span class="pill ok">active</span>'}</td>
      </tr>
    `).join('');
  }
}
