-- Leaderboard kit: a per-board minimum game version. Runs after the core and
-- periods migrations and before app migrations.

-- Oldest game build ('1.4', '1.4.2', 'v2.0.0-beta.1') whose runs this board
-- accepts. Older or missing versions are refused with GAME_VERSION_TOO_OLD so
-- the client can tell the player to update. NULL accepts any version.
ALTER TABLE lb_boards ADD COLUMN IF NOT EXISTS min_game_version VARCHAR(40);
