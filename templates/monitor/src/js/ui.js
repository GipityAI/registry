/**
 * Shared UI feedback helpers — loading skeletons, panel-level errors, and the
 * re-render hook that lets any module (sub-tab strips, Retry buttons) ask the
 * orchestrator to re-render the active tab with the CURRENT filters.
 *
 * The hook exists because sub-tab click handlers are bound once, on the tab's
 * first render — recursing into their own render fn from that closure would
 * replay the filters captured back then. Routing every re-render through
 * main.js's renderActiveTab() keeps filters fresh and gives sub-tab switches
 * the same loading/error treatment as top-level tabs.
 */

let renderer = null;

/** main.js registers its renderActiveTab here at startup. */
export function setRenderer(fn) { renderer = fn; }

/** Re-render the active tab with current filters (no-op until registered). */
export function requestRender() { if (renderer) renderer(); }

// ── Loading states ──────────────────────────────────────────────────────────
// First visit to a (sub-)panel → skeleton shimmer over the empty cards, chart
// areas, and table bodies. Re-render of a panel that already has data → keep
// the stale content visible, just dimmed (`revalidating`), so numbers never
// blank out while fresh data is in flight.

/** The sub-panel the user actually sees, for tabs with sub-tab strips. */
function visibleScope(panel) {
  return panel.querySelector(
    '.svc-panel:not([hidden]), .cmp-panel:not([hidden]), .data-panel:not([hidden]), .hosting-panel:not([hidden])'
  ) || panel;
}

function hasRenderedData(scope) {
  if (scope.querySelector('tbody tr:not(.skeleton-row)')) return true;
  return Array.from(scope.querySelectorAll('.card-value'))
    .some((el) => el.textContent.trim() !== '—' && el.textContent.trim() !== '');
}

export function beginTabLoad(panel) {
  if (!panel) return;
  clearTabError(panel);
  const scope = visibleScope(panel);
  if (hasRenderedData(scope)) {
    panel.classList.add('revalidating');
    return;
  }
  panel.classList.add('skeleton');
  // Empty table bodies get placeholder rows so tables don't collapse to just
  // a header while loading. Renders overwrite tbody.innerHTML wholesale, so
  // these disappear naturally; endTabLoad sweeps any survivors.
  for (const tbody of scope.querySelectorAll('.data-table tbody')) {
    if (tbody.children.length) continue;
    tbody.innerHTML = Array.from({ length: 3 }, () =>
      '<tr class="skeleton-row"><td colspan="9"><span class="skeleton-bar"></span></td></tr>'
    ).join('');
  }
}

export function endTabLoad(panel) {
  if (!panel) return;
  panel.classList.remove('skeleton', 'revalidating');
  for (const row of panel.querySelectorAll('tr.skeleton-row')) row.remove();
}

// ── Panel-level error state ─────────────────────────────────────────────────
// Shown at the top of the active tab when its fetches reject; stale content
// (if any) stays visible below it. Retry re-renders with current filters.

export function showTabError(panel, err) {
  if (!panel) return;
  clearTabError(panel);
  const box = document.createElement('div');
  box.className = 'tab-error';
  box.setAttribute('role', 'alert');
  const msg = document.createElement('span');
  msg.textContent = "Couldn't load this view.";
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'retry-btn';
  retry.textContent = 'Retry';
  retry.addEventListener('click', () => requestRender());
  const detail = document.createElement('span');
  detail.className = 'tab-error-detail';
  detail.textContent = err && err.message ? err.message : '';
  box.append(msg, retry, detail);
  panel.prepend(box);
}

export function clearTabError(panel) {
  if (!panel) return;
  for (const el of panel.querySelectorAll(':scope > .tab-error')) el.remove();
}
