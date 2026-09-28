-- Leaderboard kit: configurable ranking periods, named seasons, and a tiebreak
-- score. Runs after 000-kit-leaderboard-core.sql and before app migrations.

-- Which windows a board ranks: any of all, day, week, month, season.
ALTER TABLE lb_boards ADD COLUMN IF NOT EXISTS periods TEXT[] NOT NULL DEFAULT ARRAY['all', 'week'];
-- A second number that orders equal scores ('asc' or 'desc'); NULL = none,
-- and equal scores keep submission order.
ALTER TABLE lb_boards ADD COLUMN IF NOT EXISTS tiebreak_sort VARCHAR(4) CHECK (tiebreak_sort IN ('asc', 'desc'));

-- Period keys: 'all', '2026-09-28', '2026-W40', '2026-09', 'season:<name>'.
ALTER TABLE lb_entries ALTER COLUMN period TYPE VARCHAR(60);
ALTER TABLE lb_entries ADD COLUMN IF NOT EXISTS tiebreak BIGINT;
ALTER TABLE lb_submissions ADD COLUMN IF NOT EXISTS tiebreak BIGINT;

-- Named seasons. The running season is the latest one whose window contains
-- NOW(); boards with 'season' in their periods rank within it.
CREATE TABLE IF NOT EXISTS lb_seasons (
    name       VARCHAR(40)  PRIMARY KEY,
    starts_at  TIMESTAMPTZ  NOT NULL,
    ends_at    TIMESTAMPTZ  NOT NULL,
    CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_lb_seasons_window ON lb_seasons(starts_at, ends_at);
