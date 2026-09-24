// Pure-unit tests for the renderer's style-merge helper. No DB, no API,
// no Remotion — just the function. Imported via require() since the
// renderer is CommonJS; main.js guards its entrypoint on require.main, so
// importing it here does NOT start a render.
//
// Why this test exists: the JSX template strings and RENDER_DEFAULTS both live
// in jobs/render/main.js and MUST agree on what the "no-options" look is, or
// the back-compat promise (NULL render_options = identical pixels to today)
// breaks silently. These tests pin the contract.

const { RENDER_DEFAULTS, resolveRenderStyle, frameDimensions } = require('../jobs/render/main.js');

test('RENDER_DEFAULTS exposes exactly the controls the Style tab edits', () => {
  assert.deepEqual(Object.keys(RENDER_DEFAULTS).sort(), [
    'aspect', 'bg_color', 'font_mode', 'font_pct', 'pad_px', 'phrase_mode',
    'phrase_target', 'show_next_line', 'show_watermark',
    'word_active', 'word_future', 'word_past',
  ]);
});

test('RENDER_DEFAULTS pins the pre-Style-tab look — colors, size, shape, phrasing', () => {
  // These color constants ALSO appear in the JSX as DEFAULT_BG / DEFAULT_WORD_*.
  // Drift between the two spots is the regression this asserts against.
  assert.equal(RENDER_DEFAULTS.bg_color,    '#0e0e10');
  assert.equal(RENDER_DEFAULTS.word_active, '#ff7a00');
  assert.equal(RENDER_DEFAULTS.word_past,   '#ffffff');
  assert.equal(RENDER_DEFAULTS.word_future, '#888896');
  assert.equal(RENDER_DEFAULTS.font_mode,   'pct');
  assert.equal(RENDER_DEFAULTS.font_pct,    8);
  assert.equal(RENDER_DEFAULTS.pad_px,      25);
  assert.equal(RENDER_DEFAULTS.aspect,      '16:9');
  // Phrasing + footers default on, so an unstyled render matches prior output.
  assert.equal(RENDER_DEFAULTS.phrase_mode,    'natural');
  assert.equal(RENDER_DEFAULTS.phrase_target,  8);
  assert.equal(RENDER_DEFAULTS.show_next_line, true);
  assert.equal(RENDER_DEFAULTS.show_watermark, true);
});

test('resolveRenderStyle(null) returns the defaults — back-compat path', () => {
  assert.deepEqual(resolveRenderStyle(null), { ...RENDER_DEFAULTS });
  assert.deepEqual(resolveRenderStyle(undefined), { ...RENDER_DEFAULTS });
  assert.deepEqual(resolveRenderStyle('not an object'), { ...RENDER_DEFAULTS });
});

test('resolveRenderStyle merges valid keys; each missing key holds its default', () => {
  const partial = resolveRenderStyle({ bg_color: '#101418', font_pct: 12 });
  assert.equal(partial.bg_color,    '#101418');     // overridden
  assert.equal(partial.word_active, '#ff7a00');     // default
  assert.equal(partial.word_past,   '#ffffff');     // default
  assert.equal(partial.word_future, '#888896');     // default
  assert.equal(partial.font_pct,    12);            // overridden
});

test('resolveRenderStyle rejects malformed colors and out-of-range font_pct', () => {
  const result = resolveRenderStyle({
    bg_color:    '#fff',         // 3-digit hex — rejected (must be 6)
    word_active: 'red',          // named — rejected
    word_past:   '#zzzzzz',      // non-hex chars — rejected
    word_future: '#888896',      // valid — kept
    font_pct:    99,             // out of [2, 50] — rejected
  });
  // Only word_future overrides; rest are defaults.
  assert.equal(result.bg_color,    RENDER_DEFAULTS.bg_color);
  assert.equal(result.word_active, RENDER_DEFAULTS.word_active);
  assert.equal(result.word_past,   RENDER_DEFAULTS.word_past);
  assert.equal(result.word_future, '#888896');
  assert.equal(result.font_pct,    RENDER_DEFAULTS.font_pct);
});

test('resolveRenderStyle: font_pct clamps range (max 50) + snaps to 0.5', () => {
  assert.equal(resolveRenderStyle({ font_pct: 2 }).font_pct, 2);      // min ok
  assert.equal(resolveRenderStyle({ font_pct: 50 }).font_pct, 50);    // max ok (raised to 50)
  assert.equal(resolveRenderStyle({ font_pct: 8.3 }).font_pct, 8.5);  // snapped
  assert.equal(resolveRenderStyle({ font_pct: 1 }).font_pct, 8);      // <2 → default
  assert.equal(resolveRenderStyle({ font_pct: 51 }).font_pct, 8);     // >50 → default
});

test('resolveRenderStyle: font_mode honors "max", ignores junk', () => {
  assert.equal(resolveRenderStyle({ font_mode: 'max' }).font_mode, 'max');
  assert.equal(resolveRenderStyle({ font_mode: 'pct' }).font_mode, 'pct');
  assert.equal(resolveRenderStyle({ font_mode: 'huge' }).font_mode, 'pct'); // default
});

test('resolveRenderStyle: pad_px clamps + rounds', () => {
  assert.equal(resolveRenderStyle({ pad_px: 0 }).pad_px, 0);     // min ok
  assert.equal(resolveRenderStyle({ pad_px: 200 }).pad_px, 200); // max ok
  assert.equal(resolveRenderStyle({ pad_px: 40.6 }).pad_px, 41); // rounded
  assert.equal(resolveRenderStyle({ pad_px: -1 }).pad_px, 25);   // <0 → default
  assert.equal(resolveRenderStyle({ pad_px: 999 }).pad_px, 25);  // >200 → default
});

test('resolveRenderStyle: show_watermark honors explicit false, ignores non-boolean', () => {
  assert.equal(resolveRenderStyle({ show_watermark: false }).show_watermark, false);
  assert.equal(resolveRenderStyle({ show_watermark: true }).show_watermark, true);
  assert.equal(resolveRenderStyle({ show_watermark: 0 }).show_watermark, true); // default
});

test('resolveRenderStyle: aspect honors 9:16 / 1:1, rejects junk', () => {
  assert.equal(resolveRenderStyle({ aspect: '9:16' }).aspect, '9:16');
  assert.equal(resolveRenderStyle({ aspect: '1:1' }).aspect, '1:1');
  assert.equal(resolveRenderStyle({ aspect: '16:9' }).aspect, '16:9');
  assert.equal(resolveRenderStyle({ aspect: '4:3' }).aspect, '16:9');   // unsupported → default
  assert.equal(resolveRenderStyle({ aspect: 42 }).aspect, '16:9');      // non-string → default
});

test('resolveRenderStyle: show_next_line honors explicit false, ignores non-boolean', () => {
  assert.equal(resolveRenderStyle({ show_next_line: false }).show_next_line, false);
  assert.equal(resolveRenderStyle({ show_next_line: true }).show_next_line, true);
  assert.equal(resolveRenderStyle({ show_next_line: 'no' }).show_next_line, true); // default
});

test('frameDimensions: tier short-side × aspect, even dims', () => {
  assert.deepEqual(frameDimensions(720, '16:9'),  { width: 1280, height: 720 });
  assert.deepEqual(frameDimensions(720, '9:16'),  { width: 720, height: 1280 });
  assert.deepEqual(frameDimensions(720, '1:1'),   { width: 720, height: 720 });
  assert.deepEqual(frameDimensions(1080, '16:9'), { width: 1920, height: 1080 });
  assert.deepEqual(frameDimensions(2160, '16:9'), { width: 3840, height: 2160 });
  // unknown aspect → 16:9 fallback
  assert.deepEqual(frameDimensions(720, 'bogus'), { width: 1280, height: 720 });
  // all dims even (h264)
  for (const a of ['16:9', '9:16', '1:1']) {
    const d = frameDimensions(1080, a);
    assert.equal(d.width % 2, 0);
    assert.equal(d.height % 2, 0);
  }
});

test('resolveRenderStyle ignores unknown keys (client drift defense)', () => {
  const result = resolveRenderStyle({
    bg_color: '#101418',
    next_phrase_color: '#3a3a40',  // not in our set
    font_family: 'Comic Sans',     // not in our set
  });
  assert.equal(result.bg_color, '#101418');
  assert.equal(result.next_phrase_color, undefined);
  assert.equal(result.font_family, undefined);
  // Exactly the known controls: 4 colors + font_mode + font_pct + pad_px +
  // aspect + phrase_mode + phrase_target + show_next_line + show_watermark = 12.
  assert.equal(Object.keys(result).length, 12);
});

test('resolveRenderStyle: phrase_mode "length" + valid target is kept', () => {
  const r = resolveRenderStyle({ phrase_mode: 'length', phrase_target: 3 });
  assert.equal(r.phrase_mode, 'length');
  assert.equal(r.phrase_target, 3);
});

test('resolveRenderStyle: invalid phrase_mode falls back to natural', () => {
  const r = resolveRenderStyle({ phrase_mode: 'sideways' });
  assert.equal(r.phrase_mode, 'natural');
});

test('resolveRenderStyle: phrase_target clamps to integer + rejects out-of-range', () => {
  assert.equal(resolveRenderStyle({ phrase_target: 4.6 }).phrase_target, 5);   // rounded
  assert.equal(resolveRenderStyle({ phrase_target: 0 }).phrase_target, 8);     // <1 → default
  assert.equal(resolveRenderStyle({ phrase_target: 99 }).phrase_target, 8);    // >20 → default
  assert.equal(resolveRenderStyle({ phrase_target: 'big' }).phrase_target, 8); // non-number → default
});

test('resolveRenderStyle returns a fresh object each call (no shared state)', () => {
  const a = resolveRenderStyle({ bg_color: '#aaaaaa' });
  const b = resolveRenderStyle({ bg_color: '#bbbbbb' });
  assert.equal(a.bg_color, '#aaaaaa');
  assert.equal(b.bg_color, '#bbbbbb');
  // Mutating one doesn't affect the other or the defaults.
  a.bg_color = '#cccccc';
  assert.equal(b.bg_color, '#bbbbbb');
  assert.equal(RENDER_DEFAULTS.bg_color, '#0e0e10');
});
