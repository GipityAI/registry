/**
 * GET  /api/{appGuid}/fn/song-get?guid=song_xxxx
 * POST /api/{appGuid}/fn/song-get { song_guid: 'song_xxxx' }
 *
 * Returns the song row + its renders, ordered newest-first. The editor + result
 * views both call this on every status poll.
 */
export default async function songGet(ctx, { db }) {
  const songGuid = (ctx.query && ctx.query.guid) || (ctx.body && ctx.body.song_guid);
  if (!songGuid) return { error: 'song_guid (or ?guid=) is required' };

  const songRes = await db.query(
    `SELECT short_guid, title, audio_url, lyrics, phonetic_lyrics, corrections,
            alignment_json, align_run_guid, align_skip_demucs, align_refine_onsets,
            status, error_message, created_at, updated_at
       FROM songs WHERE short_guid = $1`,
    [songGuid],
  );
  if (songRes.rows.length === 0) return { error: 'song not found' };
  const song = songRes.rows[0];

  const rendersRes = await db.query(
    `SELECT short_guid, mode, status, video_url, render_run_guid, error_message, duration_ms, created_at,
            render_options, render_frames, fps, resolution, aspect
       FROM renders WHERE song_guid = $1 ORDER BY created_at DESC`,
    [songGuid],
  );

  return { song, renders: rendersRes.rows };
}
