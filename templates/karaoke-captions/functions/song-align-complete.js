/**
 * Fires automatically when the audio-align job for a song finishes (declared
 * as `on_complete: song-align-complete` on the audio-align job in gipity.yaml).
 *
 * ctx.body shape (from the platform's on_complete dispatcher):
 *   { run_guid, job_name, status, output, error, duration_ms }
 *
 * On success: writes alignment_json + flips status to 'aligned'.
 * On failure: records error_message + flips status to 'failed'.
 */
export default async function songAlignComplete(ctx, { db }) {
  const { run_guid, status, output, error } = ctx.body || {};
  if (!run_guid) return { error: 'run_guid missing from on_complete payload' };

  // Locate the song by the run guid we stamped at submit time.
  const songRes = await db.query(
    `SELECT short_guid FROM songs WHERE align_run_guid = $1`,
    [run_guid],
  );
  if (songRes.rows.length === 0) {
    // Run wasn't ours (e.g. someone invoked audio-align directly without
    // going through song-align). Nothing to update — exit clean.
    return { ok: true, ignored: true };
  }
  const songGuid = songRes.rows[0].short_guid;

  if (status === 'success' && output) {
    await db.query(
      `UPDATE songs
          SET alignment_json = $1,
              status = 'aligned',
              error_message = NULL,
              updated_at = NOW()
        WHERE short_guid = $2`,
      [JSON.stringify(output), songGuid],
    );
    return { ok: true, song_guid: songGuid, status: 'aligned' };
  }

  await db.query(
    `UPDATE songs
        SET status = 'failed',
            error_message = $1,
            updated_at = NOW()
      WHERE short_guid = $2`,
    [error || `align run terminated with status=${status}`, songGuid],
  );
  return { ok: true, song_guid: songGuid, status: 'failed' };
}
