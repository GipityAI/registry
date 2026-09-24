/**
 * POST /api/{appGuid}/fn/song-create
 *
 * Body: { audio_url, lyrics, phonetic_lyrics?, corrections?, title? }
 * Returns: { song_guid, status: 'created' }
 *
 * Creates the song row + persists the user's inputs. The alignment is NOT
 * fired here — call song-align next (or POST to song-align directly with the
 * returned guid; the UI auto-chains).
 */
export default async function songCreate(ctx, { db, guid }) {
  const { audio_url, lyrics, phonetic_lyrics, corrections, title } = ctx.body || {};

  if (!audio_url || typeof audio_url !== 'string') return { error: 'audio_url is required (string)' };
  if (!lyrics || typeof lyrics !== 'string') return { error: 'lyrics is required (string)' };
  if (phonetic_lyrics && typeof phonetic_lyrics !== 'string') return { error: 'phonetic_lyrics must be a string' };
  if (corrections && !Array.isArray(corrections)) return { error: 'corrections must be an array of {from, to}' };

  // Word-count sanity check up front so the user gets a clean error instead of
  // a GPU job that runs for 30 s and then exits 2. The kit's main.py also
  // validates this — we mirror it client-side for UX.
  if (phonetic_lyrics) {
    const lyW = lyrics.split(/\s+/).filter(Boolean).length;
    const phW = phonetic_lyrics.split(/\s+/).filter(Boolean).length;
    if (lyW !== phW) {
      return { error: `phonetic_lyrics word count (${phW}) must match lyrics word count (${lyW})` };
    }
  }

  const songGuid = guid('song');
  await db.query(
    `INSERT INTO songs (short_guid, title, audio_url, lyrics, phonetic_lyrics, corrections, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'created')`,
    [songGuid, title || null, audio_url, lyrics, phonetic_lyrics || null, corrections ? JSON.stringify(corrections) : null],
  );

  return { song_guid: songGuid, status: 'created' };
}
