/**
 * Tab 4 · Render — one list of every render, newest first. Each finished render
 * has an inline ▶ Play that expands a <video> in place, plus its metrics
 * (resolution · aspect · render time · frames · fps). Rendering/queued/failed
 * rows show status.
 *
 * Pure presentation — data comes from poll cycles in main.js. To survive the
 * 2 s poll without resetting a video the user is watching, we DON'T blow away
 * innerHTML when the render set is unchanged: we diff by a signature and only
 * re-render the list when it changes.
 *
 * Playback rule: a video plays ONLY when the user clicks ▶ Play (we call
 * .play() on that exact click). It NEVER autoplays — opening the tab, switching
 * away and back, or starting a new render must not start a video. resetPlayers()
 * (called by main.js on tab entry) clears the open set so a previously-open
 * player doesn't reappear playing.
 */
import { escapeHtml } from '../util.js';

const $ = (id) => document.getElementById(id);

// guids the user has expanded a player for. Cleared on tab entry (resetPlayers)
// so re-entering the tab never restores — let alone autoplays — an old player.
const openPlayers = new Set();
// signature of the last-rendered list, so an unchanged poll is a no-op.
let lastSignature = '';

/** Collapse all inline players + force a rebuild. Call when entering the tab. */
export function resetPlayers() {
  openPlayers.clear();
  lastSignature = '';
}

function statusPill(status) {
  if (status === 'done')      return `<span class="status-done">done</span>`;
  if (status === 'failed')    return `<span class="status-failed">failed</span>`;
  if (status === 'rendering') return `<span class="status-rendering">rendering…</span>`;
  return `<span class="status-queued">queued</span>`;
}

function styleChips(opts) {
  if (!opts || typeof opts !== 'object') return '<span class="muted small">defaults</span>';
  const colors = ['bg_color', 'word_active', 'word_past', 'word_future']
    .filter(k => typeof opts[k] === 'string');
  return `<span class="style-chips" title="${escapeHtml(JSON.stringify(opts))}">${
    colors.map(k => `<span class="style-chip" style="background:${opts[k]}"></span>`).join('')
  }</span>`;
}

function fmtTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch { return ''; }
}

// "1280×720 · 16:9 · 4.2s · 690f · 30fps" — only the parts we have.
function metricsLine(r) {
  const parts = [];
  if (r.resolution) parts.push(escapeHtml(r.resolution));
  if (r.aspect) parts.push(escapeHtml(r.aspect));
  if (Number.isFinite(r.duration_ms)) parts.push(`${(r.duration_ms / 1000).toFixed(1)}s`);
  if (Number.isFinite(r.render_frames)) parts.push(`${r.render_frames}f`);
  if (Number.isFinite(r.fps)) parts.push(`${r.fps}fps`);
  return parts.length ? `<span class="render-metrics muted small">${parts.join(' · ')}</span>` : '';
}

function signature(sorted) {
  // Re-render only when the set / status / url / metrics / open-state changes.
  return sorted.map(r =>
    `${r.short_guid}:${r.status}:${r.video_url || ''}:${r.duration_ms || ''}:${r.render_frames || ''}:${openPlayers.has(r.short_guid) ? 1 : 0}`
  ).join('|');
}

export function renderHistory(renders, { onUseStyle }) {
  const list = $('renders-list');
  if (!list) return;
  if (!renders || renders.length === 0) {
    list.innerHTML = '<li class="muted small">Nothing rendered yet.</li>';
    lastSignature = '';
    return;
  }

  const sorted = [...renders].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const sig = signature(sorted);
  if (sig === lastSignature) return; // nothing changed — leave the DOM (and any playing video) alone
  lastSignature = sig;

  list.innerHTML = sorted.map((r, i) => {
    const playable = r.status === 'done' && r.video_url;
    const open = playable && openPlayers.has(r.short_guid);
    return `
    <li class="render-row" data-render-guid="${escapeHtml(r.short_guid || '')}" data-render-idx="${i}">
      <div class="render-row-head">
        <span class="mode-tag">${escapeHtml(r.mode || '?')}</span>
        ${statusPill(r.status)}
        ${styleChips(r.render_options)}
        <span class="muted small">${fmtTime(r.created_at)}</span>
        ${playable ? metricsLine(r) : ''}
        <span class="spacer"></span>
        ${playable ? `<button type="button" data-action="toggle-play" data-render-idx="${i}">${open ? '▾ Hide' : '▶ Play'}</button>
           <a href="${r.video_url}" target="_blank" rel="noopener" class="render-link">Download</a>
           <button type="button" data-action="use-style" data-render-idx="${i}">Use this style</button>` : ''}
        ${r.status === 'failed' && r.error_message
          ? `<span class="muted small">${escapeHtml(r.error_message)}</span>` : ''}
      </div>
      ${open ? `<video class="render-player" src="${r.video_url}" controls preload="metadata"></video>` : ''}
    </li>`;
  }).join('');

  list.querySelectorAll('[data-action="toggle-play"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const guid = sorted[parseInt(btn.dataset.renderIdx, 10)].short_guid;
      const opening = !openPlayers.has(guid);
      if (opening) openPlayers.add(guid); else openPlayers.delete(guid);
      lastSignature = ''; // force the next render to rebuild this row
      renderHistory(renders, { onUseStyle });
      // Play ONLY on the click that opens it — never on tab load / poll redraw.
      if (opening) {
        const row = list.querySelector(`.render-row[data-render-guid="${guid}"] video`);
        if (row) row.play().catch(() => { /* autoplay-policy / user gesture — ignore */ });
      }
    });
  });

  list.querySelectorAll('[data-action="use-style"]').forEach(btn => {
    btn.addEventListener('click', () => onUseStyle(sorted[parseInt(btn.dataset.renderIdx, 10)]));
  });
}

export function mountExportTab({ getSong, onRenderAgain, onBackToStyle, onError }) {
  $('btn-render-again').addEventListener('click', async () => {
    const song = getSong();
    if (!song?.short_guid) return;
    try {
      await onRenderAgain();
    } catch (err) {
      onError(err.message);
    }
  });
  $('btn-back-to-style').addEventListener('click', () => onBackToStyle());
}
