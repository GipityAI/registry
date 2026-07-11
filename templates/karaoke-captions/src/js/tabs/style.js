/**
 * Tab 3 · Style — colors + size/shape + split. The right-column preview mirrors
 * the renderer: it's a true aspect-ratio frame, and the caption is sized off the
 * frame's SHORT SIDE (min of width/height) so a % is identical across resolution
 * AND aspect — exactly what the render job does. The render button fires
 * song-render with the assembled render_options + mode.
 *
 * Font sizing: 'pct' = font_pct% of the short side (manual); 'max' = auto-fit
 * the largest size where the phrase fits inside the frame minus pad_px.
 *
 * State is held in the DOM. currentOptions() returns a snapshot for song-render.
 * prefill() repopulates the controls from a past render.
 */
import { callFn } from '../api.js';

const $ = (id) => document.getElementById(id);

const FIELDS = [
  { id: 'opt-bg',     key: 'bg_color',    code: 'opt-bg-code' },
  { id: 'opt-active', key: 'word_active', code: 'opt-active-code' },
  { id: 'opt-past',   key: 'word_past',   code: 'opt-past-code' },
  { id: 'opt-future', key: 'word_future', code: 'opt-future-code' },
];

// The renderer's reference short side (font_pct is % of this); the preview just
// uses its own rendered short side, so the % maps 1:1 visually.
const PREVIEW_WORDS = ['Past', 'word', 'future'];

function readAspect() {
  const checked = document.querySelector('input[name="opt-aspect"]:checked');
  return checked ? checked.value : '16:9';
}

function readOptions() {
  const opts = {};
  for (const f of FIELDS) opts[f.key] = $(f.id).value;
  opts.font_mode = $('opt-font-mode').value;
  opts.font_pct = parseFloat($('opt-font-pct').value);
  opts.pad_px = parseInt($('opt-pad-px').value, 10);
  opts.aspect = readAspect();
  opts.phrase_mode = $('opt-phrase-mode').value;
  if (opts.phrase_mode === 'length') {
    opts.phrase_target = parseInt($('opt-phrase-target').value, 10);
  }
  opts.show_next_line = $('opt-show-next').checked;
  opts.show_watermark = $('opt-show-watermark').checked;
  return opts;
}

function readMode() { return $('opt-mode').value; }

// Show the words-per-line slider only when split mode is 'length'.
function syncPhraseControls() {
  const isLength = $('opt-phrase-mode').value === 'length';
  const ctrl = $('phrase-target-control');
  if (ctrl) ctrl.hidden = !isLength;
  const code = $('opt-phrase-target-code');
  if (code) code.textContent = $('opt-phrase-target').value;
}

// Hide the font % slider in 'max' mode (it's auto-fit then).
function syncFontControls() {
  const isPct = $('opt-font-mode').value !== 'max';
  const ctrl = $('font-pct-control');
  if (ctrl) ctrl.hidden = !isPct;
}

// Estimate the auto-fit font size for the preview the same way the renderer
// does: binary-search the largest px where the sample words fit in the padded
// box. Uses canvas measureText against the preview's actual pixel box.
function fitPreviewFont(boxW, boxH, pad) {
  const canvas = fitPreviewFont._c || (fitPreviewFont._c = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  const maxW = boxW - pad * 2, maxH = boxH - pad * 2;
  const measure = (px) => {
    ctx.font = '800 ' + px + 'px Inter, system-ui, sans-serif';
    let rows = 1, cur = 0, widest = 0;
    for (const t of PREVIEW_WORDS) {
      const w = ctx.measureText(t).width + px * 0.36;
      if (cur > 0 && cur + w > maxW) { widest = Math.max(widest, cur); rows++; cur = w; }
      else cur += w;
    }
    widest = Math.max(widest, cur);
    return { fits: widest <= maxW && rows * px * 1.3 <= maxH };
  };
  let lo = 6, hi = Math.round(Math.min(boxW, boxH) * 0.9), best = lo;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (measure(mid).fits) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  return best;
}

/**
 * Write a style only when it actually changes.
 *
 * applyPreview runs from a ResizeObserver on #style-preview, and it writes
 * geometry-affecting styles (padding / aspect-ratio / font-size) back onto that
 * same element. An unconditional write resizes the observed box, which re-fires
 * the observer → applyPreview → write → … Every pass also runs fitPreviewFont's
 * binary search (a dozen forced reflows), so the churn is expensive even where
 * it converges, and it can trip the browser's "ResizeObserver loop completed
 * with undelivered notifications" error. Writing only on a real change makes the
 * callback a fixed point: once settled it mutates nothing, so the observer has
 * no reason to fire again.
 */
function setStyle(el, prop, value) {
  if (el.style[prop] !== value) el.style[prop] = value;
}

function applyPreview() {
  const opts = readOptions();
  const preview = $('style-preview');
  if (preview) {
    setStyle(preview, 'background', opts.bg_color);
    setStyle(preview, 'aspectRatio', opts.aspect.replace(':', ' / '));
    // clientWidth/clientHeight are integers, so the values below are a stable
    // function of the box - they settle instead of jittering subpixel.
    const boxW = preview.clientWidth || 0;
    const boxH = preview.clientHeight || 0;
    if (boxW > 0 && boxH > 0) {
      const shortSide = Math.min(boxW, boxH);
      // Scale the authored pad (720-ref) to the preview's short side, like render.
      const pad = opts.pad_px * (shortSide / 720);
      setStyle(preview, 'padding', pad + 'px');
      let px;
      if (opts.font_mode === 'max') {
        px = fitPreviewFont(boxW, boxH, pad);
      } else {
        const want = shortSide * (opts.font_pct / 100);
        const fit = fitPreviewFont(boxW, boxH, pad);
        px = Math.min(want, fit); // crop-safe, matches renderer
      }
      setStyle(preview, 'fontSize', px + 'px');
    }
  }
  const a = preview?.querySelector('.style-preview-active');
  const p = preview?.querySelector('.style-preview-past');
  const f = preview?.querySelector('.style-preview-future');
  if (a) a.style.color = opts.word_active;
  if (p) p.style.color = opts.word_past;
  if (f) f.style.color = opts.word_future;
  for (const fld of FIELDS) {
    const codeEl = $(fld.code);
    if (codeEl) codeEl.textContent = $(fld.id).value;
  }
  const pctCode = $('opt-font-pct-code');
  if (pctCode) pctCode.textContent = opts.font_pct + '%';
  const padCode = $('opt-pad-px-code');
  if (padCode) padCode.textContent = opts.pad_px + 'px';
}

export function mountStyleTab({ getSong, onRenderRequested, onError }) {
  for (const fld of FIELDS) $(fld.id).addEventListener('input', applyPreview);
  $('opt-font-mode').addEventListener('change', () => { syncFontControls(); applyPreview(); });
  $('opt-font-pct').addEventListener('input', applyPreview);
  $('opt-pad-px').addEventListener('input', applyPreview);
  document.querySelectorAll('input[name="opt-aspect"]').forEach(r => r.addEventListener('change', applyPreview));
  $('opt-phrase-mode').addEventListener('change', syncPhraseControls);
  $('opt-phrase-target').addEventListener('input', syncPhraseControls);
  // Re-fit the preview when the box resizes (aspect change / window resize).
  if (typeof ResizeObserver !== 'undefined' && $('style-preview')) {
    new ResizeObserver(() => applyPreview()).observe($('style-preview'));
  }
  syncFontControls();
  applyPreview();
  syncPhraseControls();

  $('btn-render').addEventListener('click', async () => {
    const song = getSong();
    if (!song?.short_guid) return;
    try {
      const render_options = readOptions();
      const mode = readMode();
      await callFn('song-render', { song_guid: song.short_guid, mode, render_options });
      onRenderRequested();
    } catch (err) {
      onError(err.message);
    }
  });
}

/** Fill the form from a past render's options + mode. A snapshot missing a key
 *  means that render used the default, so reset the control to its default. */
export function prefill(options, mode) {
  if (options) {
    for (const f of FIELDS) {
      if (typeof options[f.key] === 'string') $(f.id).value = options[f.key];
    }
    $('opt-font-mode').value = options.font_mode === 'max' ? 'max' : 'pct';
    $('opt-font-pct').value = typeof options.font_pct === 'number' ? String(options.font_pct) : '8';
    $('opt-pad-px').value = typeof options.pad_px === 'number' ? String(options.pad_px) : '25';
    const aspect = (options.aspect === '9:16' || options.aspect === '1:1') ? options.aspect : '16:9';
    const aspectRadio = document.querySelector(`input[name="opt-aspect"][value="${aspect}"]`);
    if (aspectRadio) aspectRadio.checked = true;
    $('opt-phrase-mode').value = options.phrase_mode === 'length' ? 'length' : 'natural';
    if (typeof options.phrase_target === 'number') {
      $('opt-phrase-target').value = String(options.phrase_target);
    }
    $('opt-show-next').checked = options.show_next_line !== false;
    $('opt-show-watermark').checked = options.show_watermark !== false;
  }
  if (mode) $('opt-mode').value = mode;
  syncFontControls();
  applyPreview();
  syncPhraseControls();
}

export function currentOptions()  { return readOptions(); }
export function currentMode()     { return readMode(); }
