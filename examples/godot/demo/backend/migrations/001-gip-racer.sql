-- Gip Racer: the lap board and a per-lap log the race-finish function writes.
INSERT INTO lb_boards (board, sort, min_score, max_score, splits, rulesets, max_ghost_bytes) VALUES
  ('oval:lap', 'asc', 2500, 120000, 4, ARRAY['v1'], 65536)
ON CONFLICT (board) DO UPDATE SET sort = EXCLUDED.sort, min_score = EXCLUDED.min_score, max_score = EXCLUDED.max_score,
  splits = EXCLUDED.splits, rulesets = EXCLUDED.rulesets, max_ghost_bytes = EXCLUDED.max_ghost_bytes;

CREATE TABLE IF NOT EXISTS laps (
    id           VARCHAR(20) PRIMARY KEY,
    user_guid    VARCHAR(40) NOT NULL,
    provider     VARCHAR(20) NOT NULL,     -- steam | guest | gipity
    provider_id  VARCHAR(80),
    lap_ms       INTEGER     NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_laps_user ON laps(user_guid);
