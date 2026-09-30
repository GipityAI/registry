-- Leaderboard kit: boards, personal-best entries, attached ghost recordings,
-- bans, and a submission log (rate limits + a review trail for rejected runs).
-- Sorts before app migrations via the 000- prefix. Declare your own boards in
-- an app migration (see the kit README), not here.

-- One row per board. A board is a named ranking such as 'oval-1:lap' or
-- 'oval-1:race'. The rules on it are the server-side cheat checks.
CREATE TABLE IF NOT EXISTS lb_boards (
    board            VARCHAR(120) PRIMARY KEY,
    sort             VARCHAR(4)   NOT NULL DEFAULT 'asc' CHECK (sort IN ('asc', 'desc')), -- asc = lower wins (times)
    min_score        BIGINT,                          -- reject anything below (e.g. the fastest possible lap in ms)
    max_score        BIGINT,                          -- reject anything above
    splits           INTEGER,                         -- required checkpoint count, or NULL for no split check
    rulesets         TEXT[],                          -- allowed ruleset hashes; NULL = any ruleset (each ranks separately)
    max_ghost_bytes  INTEGER      NOT NULL DEFAULT 65536,
    submit_per_hour  INTEGER      NOT NULL DEFAULT 60, -- per player, per board
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Ghost recordings, stored once and shared by every entry that points at them
-- (a run that is both the all-time and the weekly best has one ghost).
-- `data` is the client's bytes, base64-encoded.
CREATE TABLE IF NOT EXISTS lb_ghosts (
    id          VARCHAR(20)  PRIMARY KEY,             -- gho_…
    data        TEXT         NOT NULL,
    bytes       INTEGER      NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- A player's personal best on a board, per ruleset, per period. `period` is
-- 'all' or an ISO week like '2026-W39', so weekly boards are just a filter.
CREATE TABLE IF NOT EXISTS lb_entries (
    id            VARCHAR(20)  PRIMARY KEY,           -- lbe_…
    board         VARCHAR(120) NOT NULL REFERENCES lb_boards(board) ON DELETE CASCADE,
    ruleset       VARCHAR(64)  NOT NULL DEFAULT '',
    period        VARCHAR(16)  NOT NULL,
    user_guid     VARCHAR(40)  NOT NULL,
    player_ref    VARCHAR(80),                        -- 'steam:7656…' when signed in with a platform, for friends views
    display_name  VARCHAR(80),
    score         BIGINT       NOT NULL,
    splits        JSONB,
    meta          JSONB,
    game_version  VARCHAR(40),
    ghost_id      VARCHAR(20)  REFERENCES lb_ghosts(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (board, ruleset, period, user_guid)
);
CREATE INDEX IF NOT EXISTS idx_lb_entries_rank ON lb_entries(board, ruleset, period, score);
CREATE INDEX IF NOT EXISTS idx_lb_entries_player ON lb_entries(player_ref);
CREATE INDEX IF NOT EXISTS idx_lb_entries_ghost ON lb_entries(ghost_id);

CREATE TABLE IF NOT EXISTS lb_bans (
    user_guid   VARCHAR(40)  PRIMARY KEY,
    reason      TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Every submission, accepted or not. Drives the per-hour rate limit and lets
-- the owner review what the cheat checks rejected.
CREATE TABLE IF NOT EXISTS lb_submissions (
    id            VARCHAR(20)  PRIMARY KEY,           -- lbs_…
    board         VARCHAR(120) NOT NULL,
    ruleset       VARCHAR(64)  NOT NULL DEFAULT '',
    user_guid     VARCHAR(40)  NOT NULL,
    score         BIGINT,
    accepted      BOOLEAN      NOT NULL,
    reason        TEXT,
    game_version  VARCHAR(40),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lb_submissions_rate ON lb_submissions(user_guid, board, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lb_submissions_created ON lb_submissions(created_at DESC);
