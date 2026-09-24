/**
 * Style-tab payload sanitiser. Strips anything that isn't a recognised key,
 * coerces types defensively, and returns null if no usable keys remain — so
 * render_options stays NULL in the DB and the renderer takes its fallback
 * path.
 *
 * Lives in its own file so the karaoke template's test suite can unit-test
 * it directly via `import { sanitizeRenderOptions } from './sanitize.js'`.
 * Requires the v2 multi-file function runtime
 * (docs/feature-backlog/function-runtime-multifile.md).
 */
export function sanitizeRenderOptions(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  const colors = ['bg_color', 'word_active', 'word_past', 'word_future'];
  for (const k of colors) {
    const v = raw[k];
    if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) out[k] = v;
  }
  // Font mode: 'max' (auto-fit) is non-default, so only persist that one.
  if (raw.font_mode === 'max') out.font_mode = 'max';
  // Font size as % of the frame's SHORT SIDE (2–50) — resolution- AND
  // aspect-independent. Only meaningful in 'pct' mode but harmless to keep.
  if (typeof raw.font_pct === 'number' && raw.font_pct >= 2 && raw.font_pct <= 50) {
    out.font_pct = Math.round(raw.font_pct * 2) / 2; // 0.5 steps
  }
  // Edge padding in px (0–200, against a 720 short-side reference). Default 25,
  // so only persist when it differs.
  if (typeof raw.pad_px === 'number' && raw.pad_px >= 0 && raw.pad_px <= 200 && Math.round(raw.pad_px) !== 25) {
    out.pad_px = Math.round(raw.pad_px);
  }
  // Aspect ratio. 16:9 is the renderer default, so only persist the non-default
  // 9:16 / 1:1 (keeps unstyled renders → NULL).
  if (raw.aspect === '9:16' || raw.aspect === '1:1') out.aspect = raw.aspect;
  // Phrasing controls. 'natural' is the renderer's default, so we only persist
  // phrase_mode when it's the non-default 'length' (keeps NULL-when-unstyled
  // back-compat intact). phrase_target is only meaningful in 'length' mode.
  if (raw.phrase_mode === 'length') {
    out.phrase_mode = 'length';
    const t = raw.phrase_target;
    if (typeof t === 'number' && t >= 1 && t <= 20) out.phrase_target = Math.round(t);
  }
  // show_next_line + show_watermark default to true in the renderer, so only
  // persist the non-default `false` (keeps unstyled renders → NULL).
  if (raw.show_next_line === false) out.show_next_line = false;
  if (raw.show_watermark === false) out.show_watermark = false;
  return Object.keys(out).length ? out : null;
}
