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
 * Set Chart.js defaults so tick labels, gridlines, and tooltips read as crisp
 * white on the dark Monitor surface. Without this, axes use Chart's default
 * dim grey (`rgba(102,102,102,1)`) and are unreadable against `--bg`.
 * Call once at startup before any chart is constructed.
 */
export function applyChartTheme() {
  // eslint-disable-next-line no-undef
  if (typeof Chart === 'undefined') return;
  // eslint-disable-next-line no-undef
  Chart.defaults.color = '#e8e4db';            // matches --text
  // eslint-disable-next-line no-undef
  Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';
  // eslint-disable-next-line no-undef
  Chart.defaults.scale.grid.color = 'rgba(255,255,255,0.06)';
  // eslint-disable-next-line no-undef
  Chart.defaults.scale.ticks.color = '#cfc9bd'; // slightly muted but readable
  // eslint-disable-next-line no-undef
  Chart.defaults.plugins.tooltip.titleColor = '#ffffff';
  // eslint-disable-next-line no-undef
  Chart.defaults.plugins.tooltip.bodyColor = '#e8e4db';
  // eslint-disable-next-line no-undef
  Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(20,20,20,0.95)';
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
      const color = ok ? '#3498db' : '#e74c3c';

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
