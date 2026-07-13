/**
 * Map a UI range to the optimal bucket granularity for the chart.
 *   1h  → minute (60 buckets)
 *   24h → hour   (24 buckets)
 *   7d  → day    (7 buckets)
 *   30d → day    (30 buckets)
 *   1y  → day    (365 buckets) — server should downsample if needed
 */
export function groupFor(range) {
  if (range === '1h') return 'minute';
  if (range === '24h') return 'hour';
  return 'day';
}

/**
 * Resolve a theme token (e.g. 'primary', 'info', 'error') to its current CSS
 * value for use inside a chart. Chart.js paints to <canvas> and can't resolve
 * CSS var()s, so datasets must read the live token values at render time —
 * charts re-render on theme change, so this stays in sync automatically.
 */
export function chartColor(token) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim();
}

/** Translucent fill for the same token, via its `--<token>-rgb` triplet. */
export function chartFill(token, alpha = 0.1) {
  const rgb = getComputedStyle(document.documentElement).getPropertyValue(`--${token}-rgb`).trim();
  return rgb ? `rgba(${rgb}, ${alpha})` : chartColor(token);
}

// ── Mark spec ────────────────────────────────────────────────────────────────
// One spec, applied by the factories below so every tab inherits it:
// 2px lines with no point markers at rest and ≥8px hover hit targets, area
// fill at ≤10% opacity, shared index tooltip + crosshair on time series,
// y-grid only (recessive hairline), legends off — the panel title names the
// single series. Charts here are ALWAYS single-series: two measures means two
// charts, never a second series or a second y-axis.

/** Crosshair: a faint vertical line through the active (hovered) index. */
export const crosshairPlugin = {
  id: 'monitorCrosshair',
  afterDatasetsDraw(chart) {
    const actives = chart.tooltip?.getActiveElements?.() || [];
    if (!actives.length || !chart.chartArea) return;
    const { ctx, chartArea } = chart;
    const x = actives[0].element.x;
    ctx.save();
    ctx.strokeStyle = chartColor('border-strong') || 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

function baseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false } },
    scales: { x: { grid: { display: false } } },
  };
}

/** Single-series time-series line — the default form for change-over-time. */
export function lineChart(canvas, { label, labels, values, color = 'primary' }) {
  // eslint-disable-next-line no-undef
  return new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: [{
      label, data: values,
      borderColor: chartColor(color), backgroundColor: chartFill(color, 0.08),
      borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0, pointHitRadius: 8,
    }] },
    options: baseOptions(),
  });
}

/** Single-series bar — counts per bucket. */
export function barChart(canvas, { label, labels, values, color = 'primary' }) {
  // eslint-disable-next-line no-undef
  return new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{
      label, data: values,
      backgroundColor: chartColor(color), borderRadius: 2, maxBarThickness: 32,
    }] },
    options: baseOptions(),
  });
}

/** Tiny axis-less sparkline for stat tiles. No tooltip, no grid — the tile's
 *  number is the readout; the line only shows shape. */
export function sparkline(canvas, { values, color = 'primary' }) {
  // eslint-disable-next-line no-undef
  return new Chart(canvas, {
    type: 'line',
    data: { labels: values.map((_, i) => i), datasets: [{
      data: values,
      borderColor: chartColor(color), backgroundColor: chartFill(color, 0.08),
      borderWidth: 1.5, fill: true, tension: 0.3, pointRadius: 0, pointHitRadius: 0,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      events: [],
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
  });
}

/**
 * Set Chart.js defaults so tick labels, gridlines, and tooltips read crisply
 * against the active theme's surface. Chart.js draws to a <canvas> and can't
 * resolve CSS `var()`s, so we read the live token values off :root here.
 * Call at startup AND after any theme change (then re-render the charts), so
 * light/blue don't leave white-on-white axes.
 */
export function applyChartTheme() {
  // eslint-disable-next-line no-undef
  if (typeof Chart === 'undefined') return;
  const css = getComputedStyle(document.documentElement);
  const tok = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  // eslint-disable-next-line no-undef
  Chart.defaults.color = tok('--text', '#e8e4db');
  // eslint-disable-next-line no-undef
  Chart.defaults.borderColor = tok('--hairline', 'rgba(255,255,255,0.08)');
  // eslint-disable-next-line no-undef
  Chart.defaults.scale.grid.color = tok('--hairline', 'rgba(255,255,255,0.06)');
  // eslint-disable-next-line no-undef
  Chart.defaults.scale.ticks.color = tok('--text-muted', '#cfc9bd');
  // eslint-disable-next-line no-undef
  Chart.defaults.plugins.tooltip.titleColor = tok('--text', '#ffffff');
  // eslint-disable-next-line no-undef
  Chart.defaults.plugins.tooltip.bodyColor = tok('--text-muted', '#e8e4db');
  // eslint-disable-next-line no-undef
  Chart.defaults.plugins.tooltip.backgroundColor = tok('--surface-2', 'rgba(20,20,20,0.95)');
  // eslint-disable-next-line no-undef
  Chart.defaults.plugins.tooltip.borderColor = tok('--border', 'rgba(255,255,255,0.1)');
  // eslint-disable-next-line no-undef
  Chart.defaults.plugins.tooltip.borderWidth = 1;
}

/**
 * Chart.js plugin that overlays deploy markers on a time-series chart.
 * Reads `chart.$annotations` (set by the tab renderer) — each entry is
 * { at: ISO timestamp, kind: 'deploy.success' | 'deploy.failure', label }.
 *
 * Snaps each annotation to its nearest bucket label and draws a small ▼ above
 * the bar/line plus a faint vertical line down. Hover tooltip is bound by the
 * tab's onHover; for v1, the marker speaks for itself.
 */
export const deployAnnotationPlugin = {
  id: 'deployAnnotations',
  afterDatasetsDraw(chart) {
    const anns = chart.$annotations;
    if (!Array.isArray(anns) || !anns.length) return;
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;
    const xs = scales.x;
    if (!xs || !chart.data.labels || !chart.data.labels.length) return;

    // Snap each annotation timestamp to the nearest bucket label.
    const bucketTimes = chart.data.labels.map((l) => new Date(l).getTime());
    if (bucketTimes.some(Number.isNaN)) return;

    ctx.save();
    for (const a of anns) {
      const t = new Date(a.at).getTime();
      if (Number.isNaN(t)) continue;
      // Find nearest bucket index
      let best = 0;
      let bestDelta = Infinity;
      for (let i = 0; i < bucketTimes.length; i++) {
        const d = Math.abs(bucketTimes[i] - t);
        if (d < bestDelta) { bestDelta = d; best = i; }
      }
      const x = xs.getPixelForValue(best);
      if (x < chartArea.left || x > chartArea.right) continue;
      const ok = a.kind !== 'deploy.failure';
      const color = ok ? chartColor('info') : chartColor('error');

      // Vertical line
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Triangle ▼ above the chart
      ctx.fillStyle = color;
      const tx = x;
      const ty = chartArea.top - 4;
      ctx.beginPath();
      ctx.moveTo(tx - 5, ty);
      ctx.lineTo(tx + 5, ty);
      ctx.lineTo(tx, ty + 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  },
};
