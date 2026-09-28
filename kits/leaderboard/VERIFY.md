# Verifying the leaderboard kit

`node kits/leaderboard/tests/core.test.js` covers the pure rules. The functions need a real app database, so verify them on a deployed dev app:

1. In an `api` app: copy `functions/` and `migrations/` in (or `gipity add leaderboard` once the kit is in the server catalog), add a board migration with a small `max_ghost_bytes`, and `gipity deploy dev`.
2. As the owner (`gipity fn call`), check:
   - a valid run is accepted with rank 1; a worse run returns `improved: false` and keeps the personal best; a better run replaces it and deletes the old ghost (`SELECT COUNT(*) FROM lb_ghosts`);
   - each rejection returns its reason: last split != score, below `min_score`, unofficial ruleset, oversized ghost; an unknown board returns `{ error }`;
   - `top` for `all`, `week` and an explicit week; `me`; `around`; `ghost`; `boards` (numbers, not strings);
   - `--anon`: reads work, while `leaderboard-submit` and `leaderboard-admin` are refused;
   - `ban` removes the entries and blocks submits; `unban` restores submitting; `reset` with `period: "week"` clears only the week.
3. With several players, run the live e2e: `APP_GUID=<guid> node kits/leaderboard/tests/e2e.mjs` (its header lists the two boards it needs). It signs in real guest players (the app needs `gipity project auth app`) and checks: ranking for `asc` and `desc`, shared ranks on ties, personal-best updates, ghosts, pagination, `around`, `me`, `friends` by `playerRef`, weekly boards, cheat rejections, and the anonymous/player/member gates.

Verified 2026-09-28 against production: steps 1-3 (e2e: 16/16).
