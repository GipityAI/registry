/**
 * POST /api/{appGuid}/fn/song-align
 *
 * Body: { song_guid, skip_demucs?, refine_onsets? }
 *
 * Submits an audio-align job for the song's current audio + lyrics. The job
 * has `on_complete: song-align-complete` declared in gipity.yaml so the result
 * lands back in the songs row automatically — the browser only needs to poll
 * song-get to watch status flip created/aligning → aligned.
 *
 * Re-aligning is safe: this just kicks off a fresh run. The old align_run_guid
 * is overwritten with the new one; the old alignment_json stays until the new
 * one comes back (so the editor never goes blank mid-realign).
 */
export default async function songAlign(ctx, { db, jobs }) {
  const { song_guid, skip_demucs, refine_onsets } = ctx.body || {};
  if (!song_guid) return { error: 'song_guid is required' };

  const songRes = await db.query(
    `SELECT audio_url, lyrics, phonetic_lyrics, corrections FROM songs WHERE short_guid = $1`,
    [song_guid],
  );
  if (songRes.rows.length === 0) return { error: 'song not found' };
  const song = songRes.rows[0];

  const input = {
    audio_url: song.audio_url,
    lyrics: song.lyrics,
    skip_demucs: skip_demucs ?? false,
    refine_onsets: refine_onsets ?? true,
  };
  if (song.phonetic_lyrics) input.phonetic_lyrics = song.phonetic_lyrics;
  if (song.corrections) input.corrections = song.corrections;

  // The sandbox jobs.submit() returns snake_case { run_guid, status, replayed }
  // (see function-runtime/sandbox-api.ts) — match it here.
  const r = await jobs.submit('audio-align', input);

  await db.query(
    `UPDATE songs
        SET align_run_guid = $1,
            align_skip_demucs = $2,
            align_refine_onsets = $3,
            status = 'aligning',
            error_message = NULL,
            updated_at = NOW()
      WHERE short_guid = $4`,
    [r.run_guid, input.skip_demucs, input.refine_onsets, song_guid],
  );

  return { song_guid, run_guid: r.run_guid, status: 'aligning' };
}
