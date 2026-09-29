# @gipity/leaderboard

Leaderboards for any game: high scores, best times, speedruns, puzzle solves. Players keep a personal best on each board, ranked all-time, daily, weekly, monthly or by season. The server checks every run for plausibility (and, if you want, a minimum game version), and you get around-me and friends views, attached replays, moderation, and automatic erasure of players who delete their account. It works from a web game and from any native client over HTTPS (for example a Godot game signed in with Steam).

## Declare your boards

A board is a named ranking. Declare boards in an app migration so they ship with your code. The columns on a board are its rules, and the server checks every submission against them.

```sql
-- migrations/001-boards.sql
INSERT INTO lb_boards (board, sort, tiebreak_sort, periods, min_score, max_score) VALUES
  ('arcade:score',   'desc', NULL,  ARRAY['all', 'day', 'week'], 0, 5000000),  -- high score
  ('puzzle:classic', 'desc', 'asc', ARRAY['all', 'season'],      0, 10000),    -- most points, then fastest
  ('level-3:time',   'asc',  NULL,  ARRAY['all', 'week'],        8000, 600000) -- speedrun, ms
ON CONFLICT (board) DO UPDATE SET
  sort = EXCLUDED.sort, tiebreak_sort = EXCLUDED.tiebreak_sort, periods = EXCLUDED.periods,
  min_score = EXCLUDED.min_score, max_score = EXCLUDED.max_score;
```

| Column | Meaning |
|---|---|
| `sort` | `desc` = higher wins (points). `asc` = lower wins (times). |
| `tiebreak_sort` | Optional second number that orders equal scores (`asc` or `desc`), such as "most points, then fastest". Boards with one require `tiebreak` on every submission. `NULL`: equal scores share a rank, and the earlier run lists first. |
| `periods` | Which rankings the board keeps, any of `all`, `day`, `week`, `month`, `season` (default `all`, `week`). Days, weeks (ISO) and months are UTC. |
| `min_score` / `max_score` | Reject anything outside. For times, set `min_score` a little under the fastest possible run. |
| `splits` | Optional checkpoint count (racing, speedruns). Each submission sends cumulative checkpoint times that must increase and end at the score. `NULL` skips the check. |
| `rulesets` | Official ruleset hashes (e.g. a hash of your difficulty or tuning settings). Only these count. `NULL` accepts any ruleset, and each ranks separately. |
| `max_ghost_bytes` | Replay size cap (default 65536). |
| `submit_per_hour` | Per player, per board (default 60). |
| `min_game_version` | Optional oldest game build whose runs count, e.g. `'1.4.2'`. Runs must send `gameVersion`; a missing or older one is refused with `code: 'GAME_VERSION_TOO_OLD'`, and one that isn't a version with `GAME_VERSION_INVALID`. Compared like semver: `1.10` > `1.9`, missing parts are 0 (`1.4` = `1.4.0`), a prerelease (`1.4.2-beta`) is older than its release, build metadata (`+77`) is ignored. `NULL` accepts any version. |

### Seasons

Boards with `season` in `periods` rank within the running season: the latest row in `lb_seasons` whose window contains now. Declare seasons in a migration too:

```sql
INSERT INTO lb_seasons (name, starts_at, ends_at) VALUES ('Season 1', '2026-10-01', '2027-01-01')
ON CONFLICT (name) DO NOTHING;
```

While no season is running, submissions skip the season ranking (a board that ranks only by season rejects them).

## Use it

Players must be signed in to submit: with Sign in with Gipity on the web, or as app players (Steam, guest) in a native game. Reads are public.

**Web:**

```js
import { submitScore, top, aroundMe, friends, ghost, seasons } from '@gipity/leaderboard';

const r = await submitScore('puzzle:classic', 9200, { tiebreak: 61400 });
// { accepted: true, improved: { all: true, season: true }, period: 'all', personalBest: 9200, rank: 4, entryId }
// or { accepted: false, reason: 'tiebreak must be an integer on this board (it breaks equal scores).' }
// or { accepted: false, code: 'GAME_VERSION_TOO_OLD', reason: 'Game version 1.3.0 is too old for this board; update to 1.4.2 or newer.' }

const { entries, total } = await top('arcade:score', { period: 'day', limit: 10 });
const near = await aroundMe('arcade:score', { radius: 3 });
const pals = await friends('arcade:score', steamFriendIds);
await top('puzzle:classic', { period: 'season' });            // or 'season:Season 1' for a past one
const { ghost: b64 } = await ghost(entries[0].entryId);       // a stored replay
```

**Any client (e.g. Godot):** `POST https://a.gipity.ai/api/<appGuid>/fn/leaderboard-submit` with `Authorization: Bearer <player token>` and the same JSON body. Reads go to `leaderboard-read` with an `action`: `top`, `around`, `me`, `friends`, `ghost`, `boards` or `seasons`.

- **Periods:** pass a kind for the current window (`all`, `day`, `week`, `month`, `season`) or a key for a past one (`2026-09-28`, `2026-W39`, `2026-09`, `season:Season 1`). The default is all-time when the board keeps it, else its first period. A period the board doesn't keep returns `{ error }`.
- **Submit results:** `improved` has one flag per period the board keeps. `rank` and `personalBest` are for the board's main period (all-time, or its first period).
- **Entries:** `{ rank, entryId, userGuid, playerRef, displayName, score, tiebreak, splits, meta, gameVersion, hasGhost, updatedAt }`. `playerRef` is `steam:<SteamID64>` for Steam players, which is what the friends view matches.
- **Replays ("ghosts")** are opaque bytes (base64 over the wire) kept with each personal best: a racing line, an input log, a puzzle solution.

## Racing example

Lap boards use splits, rulesets and ghosts:

```sql
INSERT INTO lb_boards (board, sort, min_score, max_score, splits, rulesets) VALUES
  ('oval-1:lap', 'asc', 12000, 90000, 3, ARRAY['a1f09c']);
```

```js
await submitScore('oval-1:lap', 31250, { ruleset: 'a1f09c', splits: [10400, 21010, 31250], ghost: base64Bytes });
```

## Moderate

`leaderboard-admin` is `auth: member`, so only you and your project members can call it:

```bash
gipity fn call leaderboard-admin '{"action":"submissions","board":"arcade:score","rejectedOnly":true}'
gipity fn call leaderboard-admin '{"action":"remove","entryId":"lbe_..."}'
gipity fn call leaderboard-admin '{"action":"ban","userGuid":"u_...","reason":"impossible score"}'
gipity fn call leaderboard-admin '{"action":"unban","userGuid":"u_..."}'
gipity fn call leaderboard-admin '{"action":"reset","board":"arcade:score","period":"day"}'
gipity fn call leaderboard-admin '{"action":"purge","userGuid":"u_..."}'
```

Banning removes the player's entries and hides them from every view. `purge` erases a player completely: their entries, submission log, any ban, and the ghosts only they used.

## Deleted players

`leaderboard-player-deleted` is declared with `hooks: [user_deleted]`, so when a player signed in to your app (Steam or guest) deletes their account, the platform runs it before removing them and it purges their leaderboard data, display name included. If it fails, the player is not deleted and the delete call returns an error the game can retry, and you see why in the function's logs (`gipity logs fn leaderboard-player-deleted`). It is `auth: member` and refuses any call the platform didn't make, so no one can use it to erase someone else. Players signed in with a Gipity account are not app players; erase them by hand with `purge`.

## What the checks can and can't do

The server can't watch the game, so these are plausibility checks: bounds, official rulesets, consistent splits, and rate limits. A careful cheater can still fake a plausible run. Review rejected submissions and ban. Replay bytes are stored as-is and are not inspected.

## What it ships

- **Functions:** `leaderboard-submit` (user), `leaderboard-read` (public), `leaderboard-admin` (member), `leaderboard-player-deleted` (member, `hooks: [user_deleted]`).
- **Tables:** `lb_boards`, `lb_entries`, `lb_ghosts`, `lb_bans`, `lb_submissions`, `lb_seasons`.
- **Frontend** (`@gipity/leaderboard`): `submitScore`, `top`, `aroundMe`, `myEntry`, `friends`, `ghost`, `boards`, `seasons`.

Needs a database: install into a `web-fullstack` or `api` app.
