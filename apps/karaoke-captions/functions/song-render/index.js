/**
 * POST /api/{appGuid}/fn/song-render
 *
 * Body: { song_guid, mode?, render_options? }
 *   - mode (resolution tier): 'preview' (720p) | 'hd' (1080p) | '4k' (2160p).
 *     Aspect ratio (16:9 / 9:16 / 1:1) lives in render_options.aspect.
 *   - render_options: optional style snapshot — { bg_color, word_active,
 *     word_past, word_future, font_px, phrase_mode, phrase_target,
 *     show_next_line }. Persisted on the render row so the Export tab can show
 *     what styles each past render used. Any field omitted falls back to the
 *     renderer's hard-coded default.
 *
 * Inserts a render row + submits the render job. on_complete=render-complete
 * (wired in gipity.yaml) writes back the final video_url + status.
 */
import { sanitizeRenderOptions } from './sanitize.js';

const VALID_MODES = new Set(['preview', 'hd', '4k']);

export default async function songRender(ctx, { db, jobs, guid }) {
  const { song_guid, mode = 'preview', render_options } = ctx.body || {};
  if (!song_guid) return { error: 'song_guid is required' };
  if (!VALID_MODES.has(mode)) return { error: `mode must be one of: ${[...VALID_MODES].join(', ')}` };
  const opts = sanitizeRenderOptions(render_options);

  const songRes = await db.query(
    `SELECT short_guid, alignment_json, audio_url FROM songs WHERE short_guid = $1`,
    [song_guid],
  );
  if (songRes.rows.length === 0) return { error: 'song not found' };
  const song = songRes.rows[0];
  if (!song.alignment_json) return { error: 'song has no alignment yet — align first' };

  const renderGuid = guid('rnd');
  await db.query(
    `INSERT INTO renders (short_guid, song_guid, mode, status, render_options)
     VALUES ($1, $2, $3, 'queued', $4)`,
    [renderGuid, song_guid, mode, opts ? JSON.stringify(opts) : null],
  );

  // The render job is language-agnostic compute (Node + Remotion + ffmpeg) that
  // runs on cpu-large. It needs the alignment + audio URL + chosen style to do
  // its work — we pass them in directly so the job doesn't need DB access.
  // sandbox jobs.submit() returns snake_case { run_guid, status, replayed }.
  const r = await jobs.submit('render', {
    render_guid: renderGuid,
    song_guid,
    mode,
    audio_url: song.audio_url,
    alignment_json: song.alignment_json,
    render_options: opts,
  });

  await db.query(
    `UPDATE renders
        SET render_run_guid = $1, status = 'rendering', updated_at = NOW()
      WHERE short_guid = $2`,
    [r.run_guid, renderGuid],
  );

  return { render_guid: renderGuid, run_guid: r.run_guid, status: 'rendering', mode };
}
