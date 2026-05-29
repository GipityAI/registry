-- SupCap schema: songs + renders.
--
-- One row in `songs` per "thing the user wants captioned" — owns the audio URL,
-- the lyrics + phonetic respellings, the alignment JSON once it's been computed,
-- and a pointer to the GPU run that produced it.
--
-- Each song has 0..N rows in `renders` — one per render mode (preview/4k/alpha)
-- the user has materialised. Each carries its own MP4/MOV URL + render run guid.
--
-- Both tables are project-scoped (this template ships with a per-project DB
-- declared in gipity.yaml). short_guid is the external identifier everywhere;
-- the integer `id` is never exposed in REST/JSON responses.

CREATE TABLE IF NOT EXISTS songs (
    id                  SERIAL PRIMARY KEY,
    short_guid          VARCHAR(20) NOT NULL UNIQUE,

    title               VARCHAR(200),
    audio_url           TEXT NOT NULL,             -- public URL Modal can fetch
    lyrics              TEXT NOT NULL,             -- display words
    phonetic_lyrics     TEXT,                       -- optional respelling (same word count as lyrics)
    corrections         JSONB,                      -- optional [{from, to}] when phonetic_lyrics absent

    -- Alignment state (set after the audio-align job completes / editor saves)
    alignment_json      JSONB,                      -- { words[], phrases[], metadata }
    align_run_guid      VARCHAR(20),                -- last audio-align run that touched this song
    align_skip_demucs   BOOLEAN NOT NULL DEFAULT false,
    align_refine_onsets BOOLEAN NOT NULL DEFAULT true,

    -- Lifecycle: created → aligning → aligned → failed (terminal)
    -- Re-aligning a song flips back to 'aligning' until the new run completes.
    status              VARCHAR(20) NOT NULL DEFAULT 'created',
    error_message       TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_songs_created     ON songs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_songs_status      ON songs(status);
CREATE INDEX IF NOT EXISTS idx_songs_align_run   ON songs(align_run_guid);


CREATE TABLE IF NOT EXISTS renders (
    id                  SERIAL PRIMARY KEY,
    short_guid          VARCHAR(20) NOT NULL UNIQUE,

    -- A render belongs to one song. Soft-FK by short_guid keeps cross-DB
    -- portability simple and avoids cascade-on-delete surprises while the
    -- editor is still mutating songs.
    song_guid           VARCHAR(20) NOT NULL REFERENCES songs(short_guid) ON DELETE CASCADE,

    -- 'preview' (720p, fast), '4k' (3840×2160, slow), 'alpha' (1080p with
    -- transparent background, for downstream NLE compositing).
    mode                VARCHAR(20) NOT NULL DEFAULT 'preview',

    -- Lifecycle: queued → rendering → done → failed (terminal)
    status              VARCHAR(20) NOT NULL DEFAULT 'queued',
    video_url           TEXT,                       -- set when status = 'done'
    render_run_guid     VARCHAR(20),
    error_message       TEXT,
    duration_ms         INTEGER,                    -- render wall-clock

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_renders_song      ON renders(song_guid);
CREATE INDEX IF NOT EXISTS idx_renders_created   ON renders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_renders_run_guid  ON renders(render_run_guid);
