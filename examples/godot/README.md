# Gipity for Godot

Put a Godot 4 game online with [Gipity](https://gipity.ai): Steam and guest sign-in, your own server functions and database, and leaderboards with ghost recordings, without running a server. It's plain GDScript (no native plugin), so it runs anywhere Godot exports.

Pair it with [GodotSteam](https://godotsteam.com) for real-time races through Steam's relay network and Steam lobbies. Gipity handles accounts, leaderboards, ghosts, results and moderation.

This folder lives in the [Gipity registry](https://github.com/GipityAI/registry/tree/main/examples/godot). It's sample code you copy into your game by hand, not something `gipity add` installs. It moved here from a standalone repo (source commit `a043239`).

| Folder | What |
|---|---|
| `addons/gipity/` | The addon. Copy this into your game. |
| `demo/` | Gip Racer, a small lap racer that uses every part of the addon, with its backend in `demo/backend/`. |
| `tests/` | Headless tests against a mock Gipity server. |

## Install

1. Copy `addons/gipity/` into your project's `addons/` folder. To fetch just this folder:
   ```bash
   git clone --depth 1 --filter=blob:none --sparse https://github.com/GipityAI/registry.git
   cd registry && git sparse-checkout set examples/godot
   ```
   (Or download the registry as a zip from GitHub and take `examples/godot/addons/gipity/`.)
2. Enable it under **Project > Project Settings > Plugins**. That adds the `Gipity` autoload.
3. Set **Project Settings > gipity/app_guid** to your app's guid (from `gipity project info`).

## Set up the backend (once, with the `gipity` CLI)

Keep the backend in a `backend/` folder of your game repo. The `.gdignore` file stops Godot from importing it.

```bash
mkdir backend && touch backend/.gdignore && cd backend
gipity init my-game                                 # link this folder to a new Gipity project
gipity add api                                      # a backend: functions + database
gipity add leaderboard                              # optional: leaderboards
gipity project auth app                             # players sign in to this game without a Gipity account
gipity project auth --unique-names on               # optional: no two players share a display name
gipity secrets set STEAM_WEB_API_KEY <publisher key> # Steamworks > Users & Permissions > Manage Groups > WebAPI key
gipity secrets set STEAM_APP_ID <your AppID>
gipity deploy
```

## Use it

```gdscript
func _ready():
	# GodotSteam must be initialized and Steam.run_callbacks() called every frame.
	var r = await Gipity.sign_in_steam()
	if not r.ok:
		r = await Gipity.sign_in_guest("Player")   # non-Steam builds, or Steam offline
	print(Gipity.player.displayName)
	if r.ok and Gipity.player.nameConflict:
		show_name_picker()   # unique names are on and the player needs a name of their own

func on_lap(time_ms: int, splits: Array, ghost: PackedByteArray):
	var r = await Gipity.leaderboard.submit("oval-1:lap", time_ms, {
		"ruleset": RULESET_HASH, "splits": splits, "ghost": ghost })
	if r.ok and r.data.accepted:
		print("rank ", int(r.data.rank))
	elif r.code == "GAME_VERSION_TOO_OLD":
		show_update_prompt()   # the board only takes runs from newer builds

func show_board():
	var r = await Gipity.leaderboard.top("oval-1:lap", {"period": "week", "limit": 10})
	var mine = await Gipity.leaderboard.around_me("oval-1:lap", {"radius": 3})
	var pals = await Gipity.leaderboard.friends_steam("oval-1:lap")

func race_ghost(entry_id: String):
	var r = await Gipity.leaderboard.ghost(entry_id)   # r.data is the PackedByteArray you uploaded

func pick_name(name: String):
	var check = await Gipity.check_name(name)   # works before sign-in too
	if check.ok and not check.data.available:
		show_suggestions(check.data.suggestions)   # free names like TURBO27, TURBO418
		return
	var r = await Gipity.rename_player(name)   # guests and Steam players (a name for this game)
	if r.code == "DISPLAY_NAME_REJECTED" or r.code == "DISPLAY_NAME_TAKEN":
		show_error(r.error)                     # ask for another name

func save_results(results: Dictionary):
	await Gipity.call_function("race-results", results)   # any function in your app
```

Every call returns `{ ok, data, error, code, status, offline }` and never throws. `error` is a message you can show; `code` is the server's code to branch on (`""` when there is none). When `offline` is true the game carries on; leaderboard submissions made offline are queued and sent after the next sign-in.

Codes worth handling:

| Code | From | What to do |
|---|---|---|
| `DISPLAY_NAME_REJECTED` | `sign_in_guest`, `rename_player`, `check_name` (400) | Show `error` and ask for another name. |
| `DISPLAY_NAME_TAKEN` | `sign_in_guest`, `rename_player` (409) | The app requires unique names and another player has it. Ask for another (`check_name` suggests free ones). |
| `PLAYER_CLEANUP_FAILED` | `delete_player` (502) | Nothing was deleted and the player stays signed in (`offline` is false). Try again later. |
| `GAME_VERSION_TOO_OLD`, `GAME_VERSION_INVALID` | `leaderboard.submit` | The run was refused (`ok` is true, `data.accepted` false). Ask the player to update. |

## Game version

Every leaderboard run carries your build's version (**Project Settings > application/config/version**, or `Gipity.game_version` at runtime, or `game_version` in the submit options). A board with `min_game_version` refuses older builds. A run queued offline by a build that's since too old is dropped, not retried, when it's finally sent; `queued_run_dropped(run, code, reason)` tells you, and a warning is logged.

## API

| Call | What it does |
|---|---|
| `sign_in_steam()` | Signs in the running Steam account (needs GodotSteam). |
| `sign_in_guest(name)` | A player tied to this device, for builds without Steam. |
| `link_steam()` | Attaches Steam to the signed-in guest, keeping their progress. |
| `sign_out()`, `is_signed_in()`, `player` | Session state. Tokens renew automatically. `player.nameConflict` is true when unique names are on and the player should pick a name (their Steam persona was taken, so they got `"<persona> #1234"`, or they share a name another player had first). |
| `rename_player(name)` | Sets the player's name in this game; `null` or `""` clears it. For a Steam player it wins over their persona on every sign-in; cleared, they go back to the persona. |
| `check_name(name)` | Is a name free? `data: { name, available, uniqueNames, suggestions }`. Works before sign-in; signed in, the player's own name counts as free. 30 checks a minute per IP. |
| `delete_player()` | Permanently deletes the player (account deletion requests). On `PLAYER_CLEANUP_FAILED` the session is kept so you can retry. |
| `call_function(name, body)` | Calls one of your app's functions. `data` is its return value. |
| `leaderboard.submit / top / around_me / me / friends / friends_steam / ghost / boards / seasons` | The leaderboard kit: scores or times, all-time/daily/weekly/monthly/season boards, tiebreaks, replays, minimum game versions. |

Signals: `signed_in(player)`, `signed_out`, `queued_run_dropped(run, code, reason)`.

Numbers come back from JSON as floats, so wrap them in `int()` before comparing.

## Tests

```bash
node tests/run_tests.mjs    # from examples/godot/: mock Gipity server + headless Godot (GODOT=/path/to/godot to override)
```

## License

MIT
