// song-render tests — pure unit tests of the sanitiser helper + e2e through
// the deployed function.
//
// The helper lives in functions/song-render/sanitize.js (multi-file function
// shape, v2 runtime). We import it directly here — the test harness runs in
// Node, not isolated-vm, so a normal ESM import works.
//
// Tests run in the sandboxed harness — `test()` and `assert` are globals.
// Use `ctx.fn.call()` to invoke deployed functions.

import { sanitizeRenderOptions } from '../functions/song-render/sanitize.js';

// ─── Pure helper unit tests (no API call) ──────────────────────────────────

test('sanitizeRenderOptions: null/missing → null', () => {
  assert.equal(sanitizeRenderOptions(null), null);
  assert.equal(sanitizeRenderOptions(undefined), null);
  assert.equal(sanitizeRenderOptions('not an object'), null);
});

test('sanitizeRenderOptions: keeps valid hex colors + numeric font_pct', () => {
  const out = sanitizeRenderOptions({
    bg_color: '#0e0e10',
    word_active: '#ff7a00',
    word_past: '#ffffff',
    word_future: '#888896',
    font_pct: 12,
  });
  assert.deepEqual(out, {
    bg_color: '#0e0e10',
    word_active: '#ff7a00',
    word_past: '#ffffff',
    word_future: '#888896',
    font_pct: 12,
  });
});

test('sanitizeRenderOptions: rejects malformed colors and out-of-range font_pct', () => {
  const out = sanitizeRenderOptions({
    bg_color: '#fff',            // 3-digit not allowed
    word_active: 'red',          // named not allowed
    word_past: '#zzzzzz',        // non-hex chars
    word_future: '#888896',      // valid → kept
    font_pct: 99,                // out of [2, 50]
  });
  assert.deepEqual(out, { word_future: '#888896' });
});

test('sanitizeRenderOptions: font_mode "max" persisted; "pct" dropped (default)', () => {
  assert.deepEqual(sanitizeRenderOptions({ font_mode: 'max' }), { font_mode: 'max' });
  assert.equal(sanitizeRenderOptions({ font_mode: 'pct' }), null);
  assert.equal(sanitizeRenderOptions({ font_mode: 'huge' }), null);
});

test('sanitizeRenderOptions: pad_px — non-default kept, default 25 dropped', () => {
  assert.deepEqual(sanitizeRenderOptions({ pad_px: 50 }), { pad_px: 50 });
  assert.deepEqual(sanitizeRenderOptions({ pad_px: 0 }), { pad_px: 0 });
  assert.equal(sanitizeRenderOptions({ pad_px: 25 }), null);   // default → not persisted
  assert.equal(sanitizeRenderOptions({ pad_px: 999 }), null);  // out of range → dropped
});

test('sanitizeRenderOptions: aspect — non-default kept, 16:9 dropped (it is the default)', () => {
  assert.deepEqual(sanitizeRenderOptions({ aspect: '9:16' }), { aspect: '9:16' });
  assert.deepEqual(sanitizeRenderOptions({ aspect: '1:1' }), { aspect: '1:1' });
  assert.equal(sanitizeRenderOptions({ aspect: '16:9' }), null);  // default → not persisted
  assert.equal(sanitizeRenderOptions({ aspect: '4:3' }), null);   // unsupported → dropped
});

test('sanitizeRenderOptions: show_next_line / show_watermark — false persisted, true dropped', () => {
  assert.deepEqual(sanitizeRenderOptions({ show_next_line: false }), { show_next_line: false });
  assert.deepEqual(sanitizeRenderOptions({ show_watermark: false }), { show_watermark: false });
  assert.deepEqual(
    sanitizeRenderOptions({ show_next_line: false, show_watermark: false }),
    { show_next_line: false, show_watermark: false },
  );
  // true is the default → not persisted → all-default collapses to null
  assert.equal(sanitizeRenderOptions({ show_next_line: true, show_watermark: true }), null);
});

test('sanitizeRenderOptions: all-unknown-keys → null (DB column stays NULL)', () => {
  assert.equal(sanitizeRenderOptions({ foo: 1, bar: '#fff' }), null);
});

test('sanitizeRenderOptions: phrase_mode "length" + target is kept', () => {
  const out = sanitizeRenderOptions({ phrase_mode: 'length', phrase_target: 3 });
  assert.deepEqual(out, { phrase_mode: 'length', phrase_target: 3 });
});

test('sanitizeRenderOptions: phrase_mode "natural" is NOT persisted (it is the default)', () => {
  // 'natural' matches the renderer default, so it should not bloat the row;
  // with no other keys the whole thing collapses to null.
  assert.equal(sanitizeRenderOptions({ phrase_mode: 'natural', phrase_target: 5 }), null);
});

test('sanitizeRenderOptions: out-of-range phrase_target dropped, mode still kept', () => {
  assert.deepEqual(sanitizeRenderOptions({ phrase_mode: 'length', phrase_target: 99 }), { phrase_mode: 'length' });
});

// ─── End-to-end via the deployed function ───────────────────────────────────
//
// These need a song with an existing alignment. They run only if a known
// demo song is present — otherwise they self-skip with a clear log line.

const DEMO_SONG_QUERY = 'select short_guid from songs where alignment_json is not null order by id asc limit 1';

async function findAlignedSong(ctx) {
  const rows = await ctx.db.query(DEMO_SONG_QUERY);
  return rows?.rows?.[0]?.short_guid || null;
}

test('song-render persists render_options on the renders row', async (ctx) => {
  const songGuid = await findAlignedSong(ctx);
  if (!songGuid) {
    console.log('[song-render] no aligned song available — skipping persistence test');
    return;
  }
  const styled = {
    bg_color: '#101418',
    word_active: '#ffd166',
    word_past: '#ffffff',
    word_future: '#666',
    font_scale: 1.3,
  };
  const res = await ctx.fn.call('song-render', { song_guid: songGuid, mode: 'preview', render_options: styled });
  assert.ok(res?.render_guid, 'should return a render_guid');
  const renderGuid = res.render_guid;

  const row = await ctx.db.query(
    'select render_options from renders where short_guid = $1',
    [renderGuid],
  );
  assert.ok(row.rows.length === 1, 'render row should exist');
  assert.deepEqual(row.rows[0].render_options, styled, 'render_options should round-trip exactly');
});

test('song-render with no render_options leaves the column NULL (back-compat path)', async (ctx) => {
  const songGuid = await findAlignedSong(ctx);
  if (!songGuid) {
    console.log('[song-render] no aligned song available — skipping back-compat test');
    return;
  }
  const res = await ctx.fn.call('song-render', { song_guid: songGuid, mode: 'preview' });
  assert.ok(res?.render_guid, 'should return a render_guid');
  const row = await ctx.db.query(
    'select render_options from renders where short_guid = $1',
    [res.render_guid],
  );
  assert.equal(row.rows[0].render_options, null, 'no render_options in body → NULL in DB');
});

test('song-render rejects garbage render_options without failing the whole call', async (ctx) => {
  const songGuid = await findAlignedSong(ctx);
  if (!songGuid) {
    console.log('[song-render] no aligned song available — skipping sanitize test');
    return;
  }
  const res = await ctx.fn.call('song-render', {
    song_guid: songGuid,
    mode: 'preview',
    render_options: { bg_color: 'not-a-color', font_family: 'Comic Sans' },
  });
  assert.ok(res?.render_guid, 'render should still be created');
  const row = await ctx.db.query(
    'select render_options from renders where short_guid = $1',
    [res.render_guid],
  );
  assert.equal(row.rows[0].render_options, null, 'all-garbage options → NULL, not partial');
});
