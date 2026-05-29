/**
 * karaoke-captions render job — Remotion-based MP4 renderer.
 *
 * The platform's job tier ships ONE handler file per job (plus a deps file
 * and an SDK helper). Remotion needs a registerRoot entry + composition
 * components — so we inline the JSX source here as template strings, write
 * them to /tmp at run time, and point @remotion/bundler at that path.
 *
 * Input  (via GIPITY_RUN_INPUT, set by song-render at submit time):
 *   { render_guid, song_guid, mode, audio_url, alignment_json }
 *
 * Output (printed as JSON, captured into the run's `output` field):
 *   { video_url, render_guid, mode, duration_ms, resolution }
 *
 * Cold-start cost: ~5-10 min for the npm install of Remotion + Chromium on
 * the first deploy. Subsequent renders reuse the cached node_modules.
 */
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.GIPITY_API_BASE || 'https://a.gipity.ai';
const APP_GUID = process.env.GIPITY_APP_GUID;
const APP_TOKEN = process.env.GIPITY_APP_TOKEN;

// ─── Render-style merge (inlined; pure, exported for unit tests) ─────────────
// The job tier ships ONE handler file per job (see header) — so this helper
// lives here rather than in a sibling module, and is re-exported at the bottom
// for tests/render-options.test.js. These constants MUST stay in sync with the
// DEFAULT_* values baked into COMP_SONGVIDEO_JSX below; the test pins that.

// font_pct is the caption height as a PERCENT OF THE FRAME'S SHORT SIDE
// (min(width, height)). The short side equals the resolution tier baseline
// (preview 720, hd 1080, 4k 2160) for EVERY aspect, so a given % is identical
// across both resolution AND aspect ratio — switching 16:9→9:16→1:1 or
// 720p→4K never needs a font tweak. (8% of 720 ≈ 58px, the old default.)
const FONT_PCT_MIN = 2;     // small but legible
const FONT_PCT_MAX = 50;    // half the short side — very large
const FONT_PCT_DEFAULT = 8;

// Edge padding for the caption, in px AT A 720-SHORT-SIDE REFERENCE (scaled by
// short/720 at render so it's resolution-independent like the font). Used as
// the safe margin in 'max' auto-fit and as the crop boundary in 'pct'.
const PAD_PX_MIN = 0;
const PAD_PX_MAX = 200;
const PAD_PX_DEFAULT = 25;

// Aspect ratios → width:height multiplier applied to a resolution tier's "short
// side". 16:9 landscape (default), 9:16 portrait (reels/shorts), 1:1 square.
const ASPECTS = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1] };

const RENDER_DEFAULTS = Object.freeze({
  bg_color:    '#0e0e10',
  word_active: '#ff7a00',   // Gipity orange
  word_past:   '#ffffff',
  word_future: '#888896',
  // Font sizing:
  //   font_mode 'pct' — size = font_pct% of the short side (manual slider)
  //   font_mode 'max' — auto-fit: the largest size where the whole phrase fits
  //                      inside the frame minus pad_px (both axes)
  font_mode:   'pct',
  font_pct:    FONT_PCT_DEFAULT,
  pad_px:      PAD_PX_DEFAULT,
  aspect:      '16:9',
  // Phrasing: how words are grouped into on-screen lines.
  //   'natural' — split on sentence punctuation (, . ! ? ; :) AND line breaks
  //   'length'  — re-chunk into fixed groups of `phrase_target` words
  phrase_mode:    'natural',
  phrase_target:  8,
  show_next_line: true,     // the small upcoming-phrase preview at the bottom
  show_watermark: true,     // the "BUILT ON GIPITY" footer
});

const PHRASE_TARGET_MIN = 1;
const PHRASE_TARGET_MAX = 20;

function isHexColor(s) {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

function isValidFontPct(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= FONT_PCT_MIN && v <= FONT_PCT_MAX;
}

function isValidPadPx(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= PAD_PX_MIN && v <= PAD_PX_MAX;
}

function isValidPhraseTarget(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= PHRASE_TARGET_MIN && v <= PHRASE_TARGET_MAX;
}

/** Return the style object that the renderer should use. Unknown keys in
 *  `opts` are ignored; invalid values fall back to defaults. NULL / non-
 *  object input returns the defaults verbatim — i.e. a render that came in
 *  without `render_options` renders identical pixels to today's output
 *  (16:9, font 'pct', phrase 'natural', next-line + watermark on). */
function resolveRenderStyle(opts) {
  if (!opts || typeof opts !== 'object') return { ...RENDER_DEFAULTS };
  const out = { ...RENDER_DEFAULTS };
  for (const k of ['bg_color', 'word_active', 'word_past', 'word_future']) {
    if (isHexColor(opts[k])) out[k] = opts[k];
  }
  if (opts.font_mode === 'pct' || opts.font_mode === 'max') out.font_mode = opts.font_mode;
  if (isValidFontPct(opts.font_pct)) out.font_pct = Math.round(opts.font_pct * 2) / 2; // 0.5 steps
  if (isValidPadPx(opts.pad_px)) out.pad_px = Math.round(opts.pad_px);
  if (ASPECTS[opts.aspect]) out.aspect = opts.aspect;
  if (opts.phrase_mode === 'natural' || opts.phrase_mode === 'length') out.phrase_mode = opts.phrase_mode;
  if (isValidPhraseTarget(opts.phrase_target)) out.phrase_target = Math.round(opts.phrase_target);
  if (typeof opts.show_next_line === 'boolean') out.show_next_line = opts.show_next_line;
  if (typeof opts.show_watermark === 'boolean') out.show_watermark = opts.show_watermark;
  return out;
}

/** Frame dimensions for a resolution tier + aspect. `short` is the tier's
 *  baseline (preview 720, hd 1080, 4k 2160) applied to the smaller side, so
 *  16:9 720p = 1280×720, 9:16 720p = 720×1280, 1:1 720p = 720×720. Dimensions
 *  are forced even (h264 requirement). Shared by the job + the JSX comp. */
function frameDimensions(short, aspect) {
  const [aw, ah] = ASPECTS[aspect] || ASPECTS['16:9'];
  let width, height;
  if (aw >= ah) { height = short; width = Math.round(short * aw / ah); }
  else          { width = short;  height = Math.round(short * ah / aw); }
  return { width: width - (width % 2), height: height - (height % 2) };
}

const TIER_SHORT = { preview: 720, hd: 1080, '4k': 2160 };

// ─── Remotion bundle sources (inlined; written to /tmp at run time) ──────────

const COMP_INDEX_JSX = `
import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { SongVideo } from './SongVideo.jsx';

// width/height come from inputProps (the job computes them from the resolution
// tier + chosen aspect ratio and passes them in). calculateMetadata returns
// those so ONE composition covers 16:9 / 9:16 / 1:1 at any tier.
const DEFAULT_PROPS = { audioUrl: '', alignmentJson: { words: [], phrases: [], metadata: { duration_ms: 0 } }, title: '', style: null, width: 1280, height: 720 };

function calculateMetadata({ props }) {
  const meta = (props && props.alignmentJson && props.alignmentJson.metadata) || {};
  const durationSeconds = Math.max(1, Math.ceil((meta.duration_ms || 5000) / 1000));
  // +1 s tail so the final word doesn't clip on slow decoders.
  return {
    durationInFrames: (durationSeconds + 1) * 30,
    fps: 30,
    width: props.width || 1280,
    height: props.height || 720,
  };
}

function Root() {
  return (
    <Composition id="song" component={SongVideo} width={1280} height={720} fps={30} durationInFrames={300} defaultProps={DEFAULT_PROPS} calculateMetadata={calculateMetadata} />
  );
}

registerRoot(Root);
`;

const COMP_SONGVIDEO_JSX = `
// Karaoke comp. Per-word visual roles ported from siverson914/SupCap:
//  - active word: orange (Gipity brand), bigger, bolder
//  - past words:  white but dimmed
//  - future words: light grey
//  - anim.type=code: monospace + terminal-green border panel
//  - anim.icon: emoji rendered above the word (brand callouts)
//
// Per-word fields consumed: display (or word for backwards compat), anim.type,
// anim.icon, trailing_punct. Source words remain unrendered — display drives
// the screen.
import React from 'react';
import { AbsoluteFill, Audio, useCurrentFrame, useVideoConfig } from 'remotion';

// Defaults — mirror RENDER_DEFAULTS above (same file). If a render comes in
// with no \`style\` prop, the
// composition falls back to these exact constants and renders identical
// pixels to pre-Style-tab output.
const DEFAULT_BG = '#0e0e10';
const DEFAULT_WORD_FUTURE = '#888896';
const DEFAULT_WORD_PAST = '#ffffff';
const DEFAULT_WORD_ACTIVE = '#ff7a00';
const NEXT_PHRASE_COLOR = '#3a3a40';
const CODE_BG = '#0a0f0a';
const CODE_BORDER = '#39ff66';
const CODE_TEXT = '#39ff66';

// Index of the phrase whose [start_ms, end_ms] window contains tMs, or -1 when
// we're in a gap (before the first phrase, or between two phrases). Returning
// -1 — rather than clamping to phrase 0 — is what makes the screen BLANK during
// lead-in silence and inter-phrase gaps instead of showing the next line early.
function currentPhraseIdx(phrases, tMs) {
  if (!phrases || phrases.length === 0) return -1;
  for (let i = 0; i < phrases.length; i++) {
    if (tMs >= phrases[i].start_ms && tMs <= phrases[i].end_ms) return i;
  }
  return -1;
}

// Index of the NEXT phrase that will start after tMs (for the bottom preview),
// or -1 if none remain.
function upcomingPhraseIdx(phrases, tMs) {
  if (!phrases || phrases.length === 0) return -1;
  for (let i = 0; i < phrases.length; i++) {
    if (phrases[i].start_ms > tMs) return i;
  }
  return -1;
}

const SENTENCE_PUNCT = /[,.!?;:—–]$/;

// Build the effective phrase list the video displays.
//   'length' — ignore source boundaries, re-chunk the word stream into fixed
//              groups of \`target\` words (1 = one word at a time, up to 20).
//   'natural' — split on sentence punctuation (, . ! ? ; :) glued to a word's
//              trailing_punct AND on the aligner's own phrase boundaries (line
//              breaks). So "Full-stack for the agents, ain't nobody slick as
//              me." splits at the comma and the period into two lines.
// Each synthesized phrase derives its timing from its first/last word so the
// highlight + gap-blanking + next-line logic all work off the same shape.
function buildPhrases(words, phrases, mode, target) {
  if (!words || words.length === 0) return phrases || [];

  if (mode === 'length') {
    const size = Math.max(1, Math.min(20, target | 0));
    return chunkRanges(words, (start) => Math.min(start + size - 1, words.length - 1));
  }

  // natural: collect break-after indices from punctuation + source phrase ends.
  const breakAfter = new Set();
  for (let i = 0; i < words.length; i++) {
    const punct = words[i].trailing_punct || '';
    if (SENTENCE_PUNCT.test(punct)) breakAfter.add(i);
  }
  for (const p of (phrases || [])) {
    if (typeof p.word_idx_end === 'number') breakAfter.add(p.word_idx_end);
  }
  breakAfter.add(words.length - 1); // always close the last phrase

  return chunkRanges(words, (start) => {
    for (let i = start; i < words.length; i++) {
      if (breakAfter.has(i)) return i;
    }
    return words.length - 1;
  });
}

// Walk the word list, asking endOf(start) for each chunk's last index, emitting
// {word_idx_start, word_idx_end, start_ms, end_ms} phrases.
function chunkRanges(words, endOf) {
  const out = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.max(start, endOf(start));
    out.push({
      word_idx_start: start,
      word_idx_end: end,
      start_ms: words[start].start_ms,
      end_ms: words[end].end_ms,
    });
    start = end + 1;
  }
  return out;
}

function wordState(word, tMs) {
  if (tMs < word.start_ms) return 'future';
  if (tMs <= word.end_ms) return 'active';
  return 'past';
}

// ── Text fitting (canvas measureText; Remotion runs in Chromium) ─────────────
// We measure with a single 2D context, memoized per (text, fontPx) via a cache
// keyed on the measure call, so 'max' auto-fit's binary search is cheap.
let _measureCtx = null;
function measureCtx() {
  if (!_measureCtx) {
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    _measureCtx = c ? c.getContext('2d') : null;
  }
  return _measureCtx;
}
const FONT_FAMILY = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

// Width of one word box at fontPx, INCLUDING the 0.18em side margins each Word
// carries (so the fit math matches the real layout). Bold-ish weight.
function wordWidth(ctx, text, fontPx) {
  ctx.font = '800 ' + fontPx + 'px ' + FONT_FAMILY;
  return ctx.measureText(text).width + fontPx * 0.36; // 0.18em each side
}

// Greedy line-wrap the words into rows that each fit maxW, then return the
// number of rows + the widest row. A single word wider than maxW occupies its
// own (overflowing) row — caller's binary search will shrink the font.
function layoutRows(ctx, texts, fontPx, maxW) {
  let rows = 1, cur = 0, widest = 0;
  for (const t of texts) {
    const w = wordWidth(ctx, t, fontPx);
    if (cur > 0 && cur + w > maxW) { widest = Math.max(widest, cur); rows++; cur = w; }
    else cur += w;
  }
  widest = Math.max(widest, cur);
  return { rows, widest };
}

// 'max' mode: largest integer fontPx where the whole phrase fits in
// (maxW × maxH) with greedy wrap. lineHeight 1.3 matches the render. Falls back
// to a height-fraction estimate if no canvas (shouldn't happen in Chromium).
function fitFontSize(texts, maxW, maxH, ceiling) {
  const ctx = measureCtx();
  if (!ctx || texts.length === 0) return Math.min(ceiling, Math.round(maxH * 0.5));
  let lo = 8, hi = ceiling, best = lo;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const { rows, widest } = layoutRows(ctx, texts, mid, maxW);
    const blockH = rows * mid * 1.3;
    if (widest <= maxW && blockH <= maxH) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best;
}

function Word({ word, tMs, fontSize, palette }) {
  const state = wordState(word, tMs);
  const isCode = (word.anim && word.anim.type) === 'code';
  const icon = word.anim && word.anim.icon;

  const baseColor = state === 'future' ? palette.word_future
                  : state === 'active' ? palette.word_active
                  : palette.word_past;
  const color = isCode ? CODE_TEXT : baseColor;
  const scale = state === 'active' ? 1.08 : 1.0;

  // Per-word display text + trailing punctuation glued to it.
  const displayText = (word.display ?? word.word ?? '') + (word.trailing_punct ?? '');

  // Code-styled words sit in a terminal-green panel; otherwise plain text.
  const wordStyle = isCode ? {
    display: 'inline-block',
    padding: (fontSize * 0.08) + 'px ' + (fontSize * 0.22) + 'px',
    margin: '0 ' + (fontSize * 0.18) + 'px',
    background: CODE_BG,
    border: '3px solid ' + CODE_BORDER,
    borderRadius: (fontSize * 0.14) + 'px',
    color,
    fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
    fontWeight: state === 'active' ? 800 : 600,
    transform: 'scale(' + scale + ')',
    transformOrigin: 'center',
    transition: 'transform 80ms ease-out, color 80ms ease-out',
  } : {
    display: 'inline-block',
    margin: '0 ' + (fontSize * 0.18) + 'px',
    color,
    transform: 'scale(' + scale + ')',
    transformOrigin: 'center',
    transition: 'transform 80ms ease-out, color 80ms ease-out',
    fontWeight: state === 'active' ? 800 : 600,
  };

  return (
    <span style={{ display: 'inline-block', verticalAlign: 'baseline', position: 'relative' }}>
      {icon ? (
        <span style={{
          position: 'absolute',
          left: '50%',
          top: '-' + (fontSize * 0.9) + 'px',
          transform: 'translateX(-50%) scale(' + scale + ')',
          fontSize: (fontSize * 0.7) + 'px',
          opacity: state === 'future' ? 0.3 : 1,
          transition: 'opacity 80ms ease-out, transform 80ms ease-out',
        }}>{icon}</span>
      ) : null}
      <span style={wordStyle}>{displayText}</span>
    </span>
  );
}

export function SongVideo({ audioUrl, alignmentJson, title, style }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const tMs = (frame / fps) * 1000;
  const words = (alignmentJson && alignmentJson.words) || [];
  const rawPhrases = (alignmentJson && alignmentJson.phrases) || [];
  const phraseMode = (style && style.phrase_mode) || 'natural';
  const phraseTarget = (style && typeof style.phrase_target === 'number') ? style.phrase_target : 8;
  const showNextLine = !(style && style.show_next_line === false);
  const phrases = buildPhrases(words, rawPhrases, phraseMode, phraseTarget);
  const idx = currentPhraseIdx(phrases, tMs);          // -1 in a gap → blank
  const curr = idx >= 0 ? phrases[idx] : null;
  const nextIdx = upcomingPhraseIdx(phrases, tMs);
  const next = nextIdx >= 0 ? phrases[nextIdx] : null;
  // Merge user-chosen style over hard-coded defaults — receiving an empty/
  // missing style prop renders the exact defaults from pre-Style-tab output.
  const palette = {
    bg_color:    (style && style.bg_color)    || DEFAULT_BG,
    word_active: (style && style.word_active) || DEFAULT_WORD_ACTIVE,
    word_past:   (style && style.word_past)   || DEFAULT_WORD_PAST,
    word_future: (style && style.word_future) || DEFAULT_WORD_FUTURE,
  };
  const currWords = curr ? words.slice(curr.word_idx_start, curr.word_idx_end + 1) : [];
  const nextWords = next ? words.slice(next.word_idx_start, next.word_idx_end + 1) : [];

  // Padding scales from a 720-short-side reference so it's resolution-independent.
  const shortSide = Math.min(width, height);
  const padPxRef = (style && typeof style.pad_px === 'number') ? style.pad_px : 25;
  const pad = Math.round(padPxRef * (shortSide / 720));
  const maxW = width - pad * 2;
  const maxH = height - pad * 2;

  // Font size:
  //   'max' — largest size where the whole phrase fits inside (maxW × maxH).
  //   'pct' — font_pct% of the SHORT SIDE (resolution- AND aspect-independent),
  //           then clamp so a too-big % still fits the frame minus padding.
  const fontMode = (style && style.font_mode === 'max') ? 'max' : 'pct';
  const fontPct = (style && typeof style.font_pct === 'number') ? style.font_pct : 8;
  const currTexts = currWords.map(w => (w.display ?? w.word ?? '') + (w.trailing_punct ?? ''));
  let fontSize;
  if (fontMode === 'max') {
    fontSize = currTexts.length ? fitFontSize(currTexts, maxW, maxH, Math.round(shortSide * 0.9)) : Math.round(shortSide * 0.08);
  } else {
    const want = Math.round(shortSide * (fontPct / 100));
    const fit = currTexts.length ? fitFontSize(currTexts, maxW, maxH, want) : want;
    fontSize = Math.min(want, fit); // crop-safe: never exceed what fits
  }
  const nextFontSize = Math.round(fontSize * 0.55);

  return (
    <AbsoluteFill style={{ background: palette.bg_color, fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' }}>
      {audioUrl ? <Audio src={audioUrl} /> : null}
      {title ? (
        <div style={{ position: 'absolute', top: height * 0.06, width: '100%', textAlign: 'center', color: '#555560', fontSize: Math.round(shortSide * 0.028), letterSpacing: '0.15em', textTransform: 'uppercase', fontWeight: 600 }}>{title}</div>
      ) : null}
      {/* Main caption: a full-frame flexbox centering the phrase as a WHOLE block
          on BOTH axes. The inner line is itself a centered flex row with
          textAlign:center + balanced wrap, so large text on square/portrait is
          truly horizontally centered (not left-justified). overflow:hidden crops
          anything that still doesn't fit rather than spilling past the frame. */}
      <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: pad + 'px', overflow: 'hidden' }}>
        <div style={{
          maxWidth: '100%', textAlign: 'center', fontSize, lineHeight: 1.3,
          display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'center',
          textWrap: 'balance',
        }}>
          {currWords.map((w, i) => <Word key={i} word={w} tMs={tMs} fontSize={fontSize} palette={palette} />)}
        </div>
      </AbsoluteFill>
      {showNextLine && nextWords.length > 0 ? (
        <div style={{ position: 'absolute', bottom: pad * 2.5, width: '100%', textAlign: 'center', fontSize: nextFontSize, color: NEXT_PHRASE_COLOR, fontWeight: 500, padding: '0 ' + pad + 'px', textWrap: 'balance' }}>
          {nextWords.map(w => (w.display ?? w.word ?? '') + (w.trailing_punct ?? '')).join(' ')}
        </div>
      ) : null}
      {(!(style && style.show_watermark === false)) ? (
        <div style={{ position: 'absolute', bottom: pad, width: '100%', textAlign: 'center', color: '#3a3a40', fontSize: Math.round(shortSide * 0.018), letterSpacing: '0.1em' }}>
          BUILT ON GIPITY
        </div>
      ) : null}
    </AbsoluteFill>
  );
}
`;

// ─── Helpers ────────────────────────────────────────────────────────────────

async function progress(pct, message) {
  const url = process.env.GIPITY_PROGRESS_URL;
  const token = process.env.GIPITY_PROGRESS_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pct, message }),
    });
  } catch { /* best-effort */ }
}

function fail(message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(2);
}

async function uploadVideo(localPath, suggestedName) {
  if (!APP_GUID || !APP_TOKEN) fail('GIPITY_APP_GUID / GIPITY_APP_TOKEN not set in job env');
  const size = fs.statSync(localPath).size;

  const initRes = await fetch(`${API_BASE}/api/${APP_GUID}/uploads/init`, {
    method: 'POST',
    headers: { 'X-App-Token': APP_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: suggestedName,
      content_type: 'video/mp4',
      size,
      public: true,
    }),
  });
  if (!initRes.ok) fail(`uploads/init: HTTP ${initRes.status} ${(await initRes.text()).slice(0, 200)}`);
  const init = (await initRes.json()).data;

  // The /uploads/init response carries the presigned PUT URL as `url`
  // (see platform api-files.ts:163). Earlier draft used `upload_url` — wrong.
  const body = fs.readFileSync(localPath);
  const putRes = await fetch(init.url, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4' },
    body,
  });
  if (!putRes.ok) fail(`S3 PUT: HTTP ${putRes.status} ${(await putRes.text()).slice(0, 200)}`);

  const completeRes = await fetch(`${API_BASE}/api/${APP_GUID}/uploads/complete`, {
    method: 'POST',
    headers: { 'X-App-Token': APP_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_guid: init.upload_guid }),
  });
  if (!completeRes.ok) fail(`uploads/complete: HTTP ${completeRes.status} ${(await completeRes.text()).slice(0, 200)}`);
  // /uploads/complete returns `data.url` (the CDN URL when is_public=true).
  // Earlier draft used `data.public_url` — wrong field name. See api-files.ts:300-313.
  return (await completeRes.json()).data.url;
}

function log(msg) { process.stderr.write(`[render] ${msg}\n`); }

async function main() {
  log('boot');
  let payload;
  try { payload = JSON.parse(process.env.GIPITY_RUN_INPUT || '{}'); }
  catch { fail('invalid GIPITY_RUN_INPUT JSON'); }

  const { render_guid, mode = 'preview', audio_url, alignment_json, render_options } = payload;
  log(`payload: render_guid=${render_guid} mode=${mode} audio_url=${audio_url ? audio_url.slice(0,60) : 'NULL'} words=${alignment_json && alignment_json.words ? alignment_json.words.length : 'NULL'} styled=${render_options ? 'yes' : 'no'}`);
  if (!render_guid)    fail('render_guid is required');
  if (!audio_url)      fail('audio_url is required');
  if (!alignment_json) fail('alignment_json is required');
  if (!TIER_SHORT[mode]) fail(`unknown mode "${mode}" (allowed: ${Object.keys(TIER_SHORT).join(', ')})`);
  const style = resolveRenderStyle(render_options);
  // Frame size = resolution tier (short side) × chosen aspect ratio.
  const { width, height } = frameDimensions(TIER_SHORT[mode], style.aspect);

  const startedAt = Date.now();

  log('writing comp to /tmp');
  await progress(0.05, 'writing Remotion comp');
  const compDir = `/tmp/remotion-${render_guid}`;
  fs.mkdirSync(compDir, { recursive: true });
  fs.writeFileSync(path.join(compDir, 'index.jsx'), COMP_INDEX_JSX);
  fs.writeFileSync(path.join(compDir, 'SongVideo.jsx'), COMP_SONGVIDEO_JSX);

  log('require remotion modules');
  await progress(0.10, 'bundling Remotion comp');
  const { bundle } = require('@remotion/bundler');
  const { selectComposition, renderMedia } = require('@remotion/renderer');

  log('bundle()');
  const bundled = await bundle({ entryPoint: path.join(compDir, 'index.jsx'), webpackOverride: (c) => c });
  log(`bundle done: ${bundled}`);

  log(`selectComposition ${width}x${height} (${mode} ${style.aspect})`);
  await progress(0.30, `selecting ${width}x${height} composition`);
  // width/height drive the single 'song' composition's calculateMetadata.
  const inputProps = { audioUrl: audio_url, alignmentJson: alignment_json, title: payload.title || '', style, width, height };
  const composition = await selectComposition({ serveUrl: bundled, id: 'song', inputProps });
  log(`composition: ${composition.width}x${composition.height} ${composition.durationInFrames}f`);

  const outPath = `/tmp/${render_guid}.mp4`;
  log(`renderMedia → ${outPath}`);
  await progress(0.35, `rendering ${composition.width}x${composition.height} @ ${composition.fps}fps`);

  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: 'h264',
    outputLocation: outPath,
    inputProps,
    audioBitrate: '192k',
    onProgress: ({ progress: p }) => {
      const pct = 0.35 + (p * 0.55);
      progress(pct, `rendering ${Math.round(p * 100)}%`).catch(() => {});
    },
  });

  await progress(0.92, 'uploading MP4');
  const videoUrl = await uploadVideo(outPath, `karaoke-${render_guid}.mp4`);

  try { fs.unlinkSync(outPath); } catch { /* ignore */ }
  try { fs.rmSync(compDir, { recursive: true, force: true }); } catch { /* ignore */ }

  await progress(1.0, 'done');
  // Render metrics surface in the Render tab. duration_ms is wall-clock for the
  // whole job; render_frames / fps describe the encode.
  console.log(JSON.stringify({
    video_url: videoUrl,
    render_guid,
    mode,
    aspect: style.aspect,
    resolution: `${composition.width}x${composition.height}`,
    duration_ms: Date.now() - startedAt,
    render_frames: composition.durationInFrames,
    fps: composition.fps,
  }));
}

// Run only when invoked as the job handler (`node main.js`). Guarding on
// require.main lets tests import resolveRenderStyle without kicking off a
// render. The job tier always runs this file directly, so the render path is
// unaffected.
if (require.main === module) {
  main().catch((err) => {
    // Surface the full stack so render failures inside Remotion / Chromium are
    // actually debuggable from app_job_runs.error_message — `.message` alone
    // loses the line numbers we need.
    process.stderr.write('[render] FATAL stack:\n');
    if (err && err.stack) process.stderr.write(err.stack + '\n');
    fail(err && err.message ? err.message : String(err));
  });
}

module.exports = { RENDER_DEFAULTS, resolveRenderStyle, frameDimensions };
