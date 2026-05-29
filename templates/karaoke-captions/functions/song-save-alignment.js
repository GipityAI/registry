/**
 * POST /api/{appGuid}/fn/song-save-alignment
 *
 * Body: { song_guid, alignment_json }
 *
 * Called by the editor whenever the user hand-tunes word timings (drag, ⇤now,
 * now⇥) and hits Save. We don't re-validate the JSON shape here — the editor
 * loaded it from us, so trust the round-trip. Worst case: render fails fast.
 */
export default async function songSaveAlignment(ctx, { db }) {
  const { song_guid, alignment_json } = ctx.body || {};
  if (!song_guid) return { error: 'song_guid is required' };
  if (!alignment_json || typeof alignment_json !== 'object') {
    return { error: 'alignment_json must be the full {words, phrases, metadata} object' };
  }

  const res = await db.query(
    `UPDATE songs
        SET alignment_json = $1,
            status = 'aligned',
            updated_at = NOW()
      WHERE short_guid = $2
      RETURNING short_guid`,
    [JSON.stringify(alignment_json), song_guid],
  );
  if (res.rows.length === 0) return { error: 'song not found' };

  return { ok: true, song_guid };
}
