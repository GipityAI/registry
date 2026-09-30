extends RefCounted
## Leaderboard kit client, reached as Gipity.leaderboard. Needs the app to have
## the kit installed (`gipity add leaderboard`) and its boards declared.
##
## Periods: "all", "day", "week", "month", "season" (the current one of each, UTC),
## or a key for a past one: "2026-09-28", "2026-W39", "2026-09", "season:<name>".
## Defaults to all-time when the board keeps it.
## Numbers come back from JSON as floats: wrap scores in int() before comparing.

const FRIEND_FLAG_IMMEDIATE := 4

var _g: Node


func _init(gipity: Node) -> void:
	_g = gipity


## Submit a score for the signed-in player.
## opts: tiebreak (int, required on boards that have one), ruleset (String),
## splits (Array of cumulative checkpoint ms), meta (Dictionary),
## ghost (PackedByteArray, a replay), game_version (String, defaults to
## application/config/version; boards with min_game_version refuse older builds).
## data: { accepted, improved: { all, week, ... }, period, personalBest, rank, entryId } or
## { accepted: false, reason, code? }. A refused run is still ok: true; the result's
## `code` carries data.code, e.g. GAME_VERSION_TOO_OLD (show "update your game") or
## GAME_VERSION_INVALID. Offline submissions are queued and retried.
func submit(board: String, score: int, opts: Dictionary = {}) -> Dictionary:
	var body := {"board": board, "score": score}
	var version := str(opts.get("game_version", _g.game_version))
	if version != "":
		body["gameVersion"] = version
	for key in ["tiebreak", "ruleset", "splits", "meta"]:
		if opts.has(key):
			body[key] = opts[key]
	if opts.has("ghost"):
		body["ghost"] = Marshalls.raw_to_base64(opts.ghost)
	var res: Dictionary = await _g.call_function("leaderboard-submit", body)
	if res.offline:
		_g._enqueue(body)
		res["queued"] = true
	return _checked(res)


## Top entries. opts: ruleset, period, limit (max 100), offset. data: { entries, total }.
func top(board: String, opts: Dictionary = {}) -> Dictionary:
	return await _read("top", board, opts)


## The signed-in player and the players around them. opts: ruleset, period, radius.
func around_me(board: String, opts: Dictionary = {}) -> Dictionary:
	return await _read("around", board, opts)


## The signed-in player's entry and rank (data.entry is null if they have none).
func me(board: String, opts: Dictionary = {}) -> Dictionary:
	return await _read("me", board, opts)


## Entries for these platform ids plus your own. ids: Array of Strings.
func friends(board: String, ids: Array, opts: Dictionary = {}) -> Dictionary:
	var o := opts.duplicate()
	o["ids"] = ids.map(func(id): return str(id))
	o["provider"] = opts.get("provider", "steam")
	return await _read("friends", board, o)


## Friends view using the running Steam account's friends list (needs GodotSteam).
func friends_steam(board: String, opts: Dictionary = {}) -> Dictionary:
	var steam: Object = _g._steam()
	if steam == null:
		return _g._fail("Steam isn't available.", 0)
	var ids: Array = []
	var count: int = steam.call("getFriendCount", FRIEND_FLAG_IMMEDIATE)
	for i in count:
		ids.append(str(steam.call("getFriendByIndex", i, FRIEND_FLAG_IMMEDIATE)))
	return await friends(board, ids, opts)


## An entry's ghost recording. data: PackedByteArray.
func ghost(entry_id: String) -> Dictionary:
	var res := await _read("ghost", "", {"entryId": entry_id})
	if res.ok:
		res.data = Marshalls.base64_to_raw(str(res.data.get("ghost", "")))
	return res


## Every board and its rules.
func boards() -> Dictionary:
	return await _read("boards", "", {})


## The running season and recent ones: data = { current, seasons }.
func seasons() -> Dictionary:
	return await _read("seasons", "", {})


func _read(action: String, board: String, opts: Dictionary) -> Dictionary:
	var body := opts.duplicate()
	body["action"] = action
	if board != "":
		body["board"] = board
	return _checked(await _g.call_function("leaderboard-read", body))


## The kit reports bad input as { error } in a 200 response; surface it as a failure.
## A refused run's data.code is copied to the result's code, so every call is
## branched on the same field.
func _checked(res: Dictionary) -> Dictionary:
	if res.ok and res.data is Dictionary:
		if res.data.has("error"):
			return _g._fail(str(res.data.error), res.status, false, str(res.data.get("code", "")))
		if res.data.get("code") != null:
			res.code = str(res.data.code)
	return res
