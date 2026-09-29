# Verifying the leaderboard kit

`node kits/leaderboard/tests/core.test.js` covers the pure rules (including version parsing and the purge's statements). The functions need a real app database, so verify them on a deployed dev app:

1. In an `api` app: copy `functions/` and `migrations/` in (or `gipity add leaderboard` once the kit is in the server catalog), add a board migration with a small `max_ghost_bytes`, and `gipity deploy dev`.
2. As the owner (`gipity fn call`), check:
   - a valid run is accepted with rank 1; a worse run returns `improved: false` and keeps the personal best; a better run replaces it and deletes the old ghost (`SELECT COUNT(*) FROM lb_ghosts`);
   - each rejection returns its reason: last split != score, below `min_score`, unofficial ruleset, oversized ghost; an unknown board returns `{ error }`;
   - `top` for `all`, `week` and an explicit week; `me`; `around`; `ghost`; `boards` (numbers, not strings);
   - `--anon`: reads work, while `leaderboard-submit` and `leaderboard-admin` are refused;
   - `ban` removes the entries and blocks submits; `unban` restores submitting; `reset` with `period: "week"` clears only the week; `purge` erases a player's entries, submissions and ghosts.
3. With several players, run the live e2e: `APP_GUID=<guid> node kits/leaderboard/tests/e2e.mjs` (its header lists the two boards it needs). It signs in real guest players (the app needs `gipity project auth app`) and checks: ranking for `asc` and `desc`, tiebreaks, daily/monthly and season boards, shared ranks on ties, personal-best updates, ghosts, pagination, `around`, `me`, `friends` by `playerRef`, weekly boards, cheat rejections, `min_game_version` refusals (with their codes), display-name refusals and guest renames, that only the platform can run the purge hook, that deleting a player erases their entries and ghosts from every period, and the anonymous/player/member gates.

The e2e boards and season, as an app migration:

```sql
INSERT INTO lb_boards (board, sort, tiebreak_sort, periods, min_score, max_score, max_ghost_bytes) VALUES
  ('e2e:time',   'asc',  NULL,  ARRAY['all', 'week'],   1000, 600000,  256),
  ('e2e:points', 'desc', NULL,  ARRAY['all', 'week'],   0,    1000000, 256),
  ('e2e:tie',    'desc', 'asc', ARRAY['all', 'week'],   0,    1000000, 256),
  ('e2e:daily',  'asc',  NULL,  ARRAY['day', 'month'],  0,    1000000, 256),
  ('e2e:season', 'desc', NULL,  ARRAY['all', 'season'], 0,    1000000, 256)
ON CONFLICT (board) DO NOTHING;
INSERT INTO lb_boards (board, sort, min_score, max_score, min_game_version) VALUES
  ('e2e:version', 'desc', 0, 1000000, '1.4.2')
ON CONFLICT (board) DO NOTHING;
INSERT INTO lb_seasons (name, starts_at, ends_at) VALUES ('E2E Season', '2026-01-01', '2036-01-01')
ON CONFLICT (name) DO NOTHING;
```

Verified 2026-09-28 against production: steps 1-3 (e2e: 20/20, including an upgrade of an existing install onto the periods/tiebreak schema).

The `min_game_version`, display-name and player-deletion checks (added 2026-09-29) have not been run live yet: they need the server redeployed with the new kit and platform code.
