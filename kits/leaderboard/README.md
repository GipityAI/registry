# @gipity/leaderboard

Leaderboards for games: personal bests with server-side cheat checks, weekly boards, "around me" and friends views, attached ghost recordings, and moderation. It works from a web game and from any native client over HTTPS, such as a Godot game signed in with Steam.

## Declare your boards

A board is a named ranking. Declare boards in an app migration so they ship with your code. The rules on a board are the server-side checks every submission must pass.

```sql
-- migrations/001-boards.sql
INSERT INTO lb_boards (board, sort, min_score, max_score, splits, rulesets) VALUES
  ('oval-1:lap',  'asc', 12000,  90000, 3, ARRAY['a1f09c']),  -- fastest lap in ms, 3 checkpoints
  ('oval-1:race', 'asc', 60000, 600000, 9, ARRAY['a1f09c'])
ON CONFLICT (board) DO UPDATE SET
  sort = EXCLUDED.sort, min_score = EXCLUDED.min_score, max_score = EXCLUDED.max_score,
  splits = EXCLUDED.splits, rulesets = EXCLUDED.rulesets;
```

| Column | Meaning |
|---|---|
| `sort` | `asc` = lower wins (times). `desc` = higher wins (points). |
| `min_score` / `max_score` | Reject anything outside. Set `min_score` a little under the fastest possible run. |
| `splits` | Required checkpoint count. Each submission sends cumulative checkpoint times that must increase and end at the score. `NULL` skips the check. |
| `rulesets` | Official ruleset hashes (e.g. a hash of your tuning settings). Only these count. `NULL` accepts any ruleset, and each ruleset ranks separately. |
| `max_ghost_bytes` | Ghost size cap (default 65536). |
| `submit_per_hour` | Per player, per board (default 60). |

## Use it

Players must be signed in to submit: with Sign in with Gipity on the web, or as app players (Steam, guest) in a game. Reads are public.

**Web:**

```js
import { submitScore, top, aroundMe, friends, ghost } from '@gipity/leaderboard';

const r = await submitScore('oval-1:lap', 31250, { ruleset: 'a1f09c', splits: [10400, 21010, 31250], ghost: base64Bytes });
// { accepted: true, improved: { allTime: true, week: true }, personalBest: 31250, rank: 4, entryId }
// or { accepted: false, reason: 'the last split must equal the score.' }

const { entries, total } = await top('oval-1:lap', { ruleset: 'a1f09c', period: 'week', limit: 10 });
const near = await aroundMe('oval-1:lap', { ruleset: 'a1f09c', radius: 3 });
const pals = await friends('oval-1:lap', steamFriendIds, { ruleset: 'a1f09c' });
const { ghost: b64 } = await ghost(entries[0].entryId);
```

**Any client (e.g. Godot):** `POST https://a.gipity.ai/api/<appGuid>/fn/leaderboard-submit` with `Authorization: Bearer <player token>` and the same JSON body. Reads go to `leaderboard-read` with an `action`: `top`, `around`, `me`, `friends`, `ghost` or `boards`.

An entry looks like `{ rank, entryId, userGuid, playerRef, displayName, score, splits, meta, gameVersion, hasGhost, updatedAt }`. `playerRef` is `steam:<SteamID64>` for Steam players, which is what the friends view matches.

Periods: `all` (default), `week` (the current ISO week, UTC), or an explicit week like `2026-W39`.

## Moderate

`leaderboard-admin` is `auth: member`, so only you and your project members can call it:

```bash
gipity fn call leaderboard-admin '{"action":"submissions","board":"oval-1:lap","rejectedOnly":true}'
gipity fn call leaderboard-admin '{"action":"remove","entryId":"lbe_..."}'
gipity fn call leaderboard-admin '{"action":"ban","userGuid":"u_...","reason":"impossible splits"}'
gipity fn call leaderboard-admin '{"action":"unban","userGuid":"u_..."}'
gipity fn call leaderboard-admin '{"action":"reset","board":"oval-1:lap","period":"week"}'
```

Banning removes the player's entries and hides them from every view.

## What the checks can and can't do

The server can't watch the game, so these are plausibility checks: bounds, official rulesets, consistent splits, and rate limits. A careful cheater can still fake a plausible run. Review rejected submissions and ban. Ghost bytes are stored as-is and are not inspected.

## What it ships

- **Functions:** `leaderboard-submit` (user), `leaderboard-read` (public), `leaderboard-admin` (member).
- **Tables:** `lb_boards`, `lb_entries`, `lb_ghosts`, `lb_bans`, `lb_submissions`.
- **Frontend** (`@gipity/leaderboard`): `submitScore`, `top`, `aroundMe`, `myEntry`, `friends`, `ghost`, `boards`.

Needs a database: install into a `web-fullstack` or `api` app.
