/**
 * Projects tab (the landing view): every project you own, where it is served,
 * and how its last deploys went, per target and per deploy phase. The same
 * data as `gipity status` / `gipity deploy`, from GET /account/logs/projects.
 */
import { fmtExact, fmtTime, fmtFullTime, escapeHtml, emptyState } from '../format.js';

const $ = (id) => document.getElementById(id);

const PHASE_CLASS = { ok: 'ok', skipped: 'muted', warning: 'warn', failed: 'error' };

/** One target's deploy: when, and each phase's status as a small pill. */
function targetCell(url, state) {
  const link = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="url-link mono small" title="${escapeHtml(url)}">${escapeHtml(url.replace(/^https:\/\//, ''))}</a>`;
  if (!state) return `${link}<div class="muted small">Never deployed</div>`;
  const phases = Object.entries(state.phases || {})
    .map(([name, status]) => `<span class="pill ${PHASE_CLASS[status] || 'info'}" title="${escapeHtml(name)}: ${escapeHtml(status)}">${escapeHtml(name)}</span>`)
    .join(' ');
  return `${link}
    <div class="muted small" title="${escapeHtml(fmtFullTime(state.last_deploy_at))}">${fmtTime(state.last_deploy_at)} · ${fmtExact(state.deploy_count)} deploys</div>
    <div class="phase-pills">${phases}</div>`;
}

function lastDeployCell(d) {
  if (!d) return '<span class="muted">-</span>';
  const pill = d.ok ? '<span class="pill ok">ok</span>' : '<span class="pill error">failed</span>';
  const detail = d.ok ? '' : (d.failed_phases?.length
    ? `<div class="small detail-error">${escapeHtml(d.failed_phases.join(', '))}</div>`
    : d.error ? `<div class="small detail-error">${escapeHtml(d.error)}</div>` : '');
  return `${pill} <span class="muted small">${escapeHtml(d.target || '')} · ${fmtTime(d.at)}</span>${detail}`;
}

export async function renderProjectsTab(api) {
  const projects = (await api.projects()).data;
  const deployed = projects.filter((p) => p.deploys.dev || p.deploys.prod).length;
  const failing = projects.filter((p) => p.last_deploy && !p.last_deploy.ok).length;
  $('projects-count').textContent = fmtExact(projects.length);
  $('projects-deployed').textContent = fmtExact(deployed);
  $('projects-failing').innerHTML = failing ? `<span class="pill error">${fmtExact(failing)}</span>` : '0';

  const body = $('table-projects').querySelector('tbody');
  if (!projects.length) {
    body.innerHTML = emptyState(5, { icon: '▢', message: 'No projects yet. Create one from your coding agent.', tryit: 'gipity init my-app' });
    return;
  }
  body.innerHTML = projects.map((p) => `
    <tr>
      <td>
        <div>${escapeHtml(p.name)}</div>
        <div class="muted small mono">${escapeHtml(p.slug)}</div>
        ${p.deploy_state !== 'ready' ? `<span class="pill ${p.deploy_state === 'failed' ? 'error' : 'info'}">${escapeHtml(p.deploy_state)}</span>` : ''}
        ${p.urls.custom.map((u) => `<div><a href="${escapeHtml(u)}" target="_blank" rel="noopener" class="url-link small">${escapeHtml(u.replace(/^https:\/\//, ''))}</a></div>`).join('')}
      </td>
      <td>${targetCell(p.urls.dev, p.deploys.dev)}</td>
      <td>${targetCell(p.urls.prod, p.deploys.prod)}</td>
      <td>${lastDeployCell(p.last_deploy)}</td>
      <td class="row-actions">
        <button type="button" class="link-btn row-link" data-goto="data/browse" data-set-project="${escapeHtml(p.short_guid)}">Files</button>
        <button type="button" class="link-btn row-link" data-goto="activity" data-set-project="${escapeHtml(p.short_guid)}">Activity</button>
        <button type="button" class="link-btn row-link" data-goto="compute/tests" data-set-project="${escapeHtml(p.short_guid)}">Tests</button>
      </td>
    </tr>
  `).join('');
}
