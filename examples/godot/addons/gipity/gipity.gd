extends Node
## Gipity backend client, registered as the "Gipity" autoload by the plugin.
##
## Sign a player in (Steam or guest), then call your app's functions and the
## leaderboard kit. Every call returns a Result dictionary and never throws:
##   { ok: bool, data: Variant, error: String, code: String, status: int, offline: bool }
## `error` is a message to show; `code` is the server's machine-readable code to
## branch on (e.g. DISPLAY_NAME_REJECTED, PLAYER_CLEANUP_FAILED,
## GAME_VERSION_TOO_OLD), "" when there is none. `offline` is true when the
## server couldn't be reached, so the game can carry on without its online features.
##
##   await Gipity.sign_in_steam()            # or: await Gipity.sign_in_guest("Racer")
##   var r = await Gipity.call_function("my-function", {"x": 1})
##   var s = await Gipity.leaderboard.submit("oval-1:lap", 31250, {"splits": [10400, 21010, 31250]})
##
## Project Settings: gipity/app_guid (required), gipity/api_base.
## Leaderboard runs carry application/config/version as their game version.

signal signed_in(player: Dictionary)
signal signed_out
## A run queued while offline was refused when it was finally sent, so it was
## dropped instead of retried. code is e.g. GAME_VERSION_TOO_OLD (the build that
## made the run is older than the board now accepts); reason is the server's message.
signal queued_run_dropped(run: Dictionary, code: String, reason: String)

const LeaderboardClient := preload("res://addons/gipity/leaderboard.gd")

const DATA_DIR := "user://gipity"
const DEVICE_FILE := "user://gipity/device.cfg"
const QUEUE_FILE := "user://gipity/queue.json"
## Must match the server: the ticket is bound to this identity.
const STEAM_TICKET_IDENTITY := "gipity"
const STEAM_RESULT_OK := 1
const REQUEST_TIMEOUT_S := 15.0
const STEAM_TICKET_TIMEOUT_MS := 10000
const QUEUE_MAX := 50
## Renew the player token this long before it expires.
const TOKEN_RENEW_MARGIN_S := 60.0

var app_guid := ""
var api_base := "https://a.gipity.ai"
## Sent with every leaderboard run. Defaults to application/config/version.
var game_version := ""
## { guid, displayName, avatarUrl, provider, providerUserId, isNew } once signed in.
var player: Dictionary = {}
## Leaderboard kit client: submit, top, around_me, me, friends, friends_steam, ghost, boards.
var leaderboard: LeaderboardClient
## A stand-in for the GodotSteam singleton (tests, or a custom Steam wrapper).
var steam_override: Object = null

var _token := ""
var _token_expires_at := 0.0
var _sign_in_method := ""
var _guest_name := ""
var _flushing := false


func _ready() -> void:
	app_guid = str(ProjectSettings.get_setting("gipity/app_guid", ""))
	api_base = str(ProjectSettings.get_setting("gipity/api_base", "https://a.gipity.ai")).trim_suffix("/")
	game_version = str(ProjectSettings.get_setting("application/config/version", ""))
	leaderboard = LeaderboardClient.new(self)


func is_signed_in() -> bool:
	return _token != "" and Time.get_unix_time_from_system() < _token_expires_at


## Sign in with the running Steam account. Needs GodotSteam, initialized, with
## Steam.run_callbacks() called every frame (the standard GodotSteam setup).
func sign_in_steam() -> Dictionary:
	var ticket := await _steam_ticket()
	if not ticket.ok:
		return ticket
	var res := await _request(HTTPClient.METHOD_POST, "/auth/steam", {"ticket": ticket.data}, false)
	return _accept_session(res, "steam")


## Sign in as a guest: a player tied to this device, for builds without Steam.
## Link it to Steam later with link_steam() to keep its progress. The name is
## only taken when the player is created; change it later with rename_player().
## A refused name fails with code DISPLAY_NAME_REJECTED: ask for another.
func sign_in_guest(display_name := "") -> Dictionary:
	_guest_name = display_name
	var body := {"deviceSecret": _device_secret()}
	if display_name != "":
		body["displayName"] = display_name
	var res := await _request(HTTPClient.METHOD_POST, "/auth/guest", body, false)
	return _accept_session(res, "guest")


## Attach the running Steam account to the signed-in guest player.
func link_steam() -> Dictionary:
	if _sign_in_method != "guest" or not is_signed_in():
		return _fail("Sign in as a guest before linking Steam.", 0)
	var ticket := await _steam_ticket()
	if not ticket.ok:
		return ticket
	var res := await _request(HTTPClient.METHOD_POST, "/auth/steam", {"ticket": ticket.data, "link": true}, true)
	return _accept_session(res, "steam")


func sign_out() -> void:
	_token = ""
	_token_expires_at = 0.0
	_sign_in_method = ""
	player = {}
	signed_out.emit()


## Rename the signed-in guest player; "" or null clears the name. data: { guid, displayName }.
## Fails with code DISPLAY_NAME_REJECTED for a refused name (show error, ask for
## another), or CONFLICT (409) for a Steam player, who is named by their Steam persona.
func rename_player(display_name = null) -> Dictionary:
	var new_name = null if display_name == null else str(display_name)
	var res := await _authed(HTTPClient.METHOD_PATCH, "/auth/player", {"displayName": new_name})
	if res.ok and res.data is Dictionary:
		var saved = res.data.get("displayName")
		player["displayName"] = saved
		_guest_name = "" if saved == null else str(saved)
	return res


## Permanently delete the signed-in player (account deletion requests).
## Code PLAYER_CLEANUP_FAILED means the app couldn't erase the player's data, so
## nothing was deleted: the player stays signed in, and calling again retries.
func delete_player() -> Dictionary:
	var res := await _authed(HTTPClient.METHOD_DELETE, "/auth/player", null)
	if res.ok:
		if _sign_in_method == "guest":
			DirAccess.remove_absolute(DEVICE_FILE)
		sign_out()
	elif res.code == "PLAYER_CLEANUP_FAILED":
		# The server answered (502, not an outage): retry later, keep the session.
		res.offline = false
	return res


## Call one of your app's functions. `data` is the function's return value.
func call_function(function_name: String, body: Dictionary = {}) -> Dictionary:
	return await _authed(HTTPClient.METHOD_POST, "/fn/" + function_name.uri_encode(), body)


## Retry leaderboard submissions queued while offline. Runs after each sign-in.
## A run the server refuses (e.g. GAME_VERSION_TOO_OLD once the board's minimum
## version has moved past the build that made it) is dropped, not retried, and
## reported through queued_run_dropped.
func flush_queue() -> void:
	if _flushing or not is_signed_in():
		return
	_flushing = true
	var pending := _load_queue()
	var kept: Array = []
	for body in pending:
		var res: Dictionary = leaderboard._checked(await call_function("leaderboard-submit", body))
		if res.offline or res.status == 401 or res.status == 429:
			kept.append(body)
		elif not res.ok or not (res.data is Dictionary and res.data.get("accepted", false)):
			var reason: String = res.error if not res.ok else str(res.data.get("reason", ""))
			push_warning("Gipity: dropped a queued %s run on '%s' (%s): %s" % [
				str(body.get("gameVersion", "unversioned")), str(body.get("board", "")), res.code if res.code != "" else "refused", reason])
			queued_run_dropped.emit(body, res.code, reason)
	_save_queue(kept)
	_flushing = false


func _enqueue(body: Dictionary) -> void:
	var q := _load_queue()
	q.append(body)
	while q.size() > QUEUE_MAX:
		q.pop_front()
	_save_queue(q)


# --- internals -------------------------------------------------------------

func _authed(method: int, path: String, body) -> Dictionary:
	if _sign_in_method != "" and not is_signed_in():
		await _reauth()
	var res := await _request(method, path, body, true)
	# The token expired or was revoked mid-session: sign in again once and retry.
	if res.status == 401 and _sign_in_method != "":
		var again := await _reauth()
		if again.ok:
			res = await _request(method, path, body, true)
	return res


func _reauth() -> Dictionary:
	if _sign_in_method == "steam":
		return await sign_in_steam()
	if _sign_in_method == "guest":
		return await sign_in_guest(_guest_name)
	return _fail("Not signed in.", 401)


func _accept_session(res: Dictionary, method: String) -> Dictionary:
	if not res.ok:
		return res
	var data: Dictionary = res.data if res.data is Dictionary else {}
	if str(data.get("token", "")) == "":
		return _fail("Sign-in response had no token.", res.status)
	_token = data.token
	_token_expires_at = Time.get_unix_time_from_system() + float(data.get("expiresIn", 3600)) - TOKEN_RENEW_MARGIN_S
	_sign_in_method = method
	player = data.get("user", {})
	res.data = player
	signed_in.emit(player)
	flush_queue()
	return res


func _request(method: int, path: String, body, auth: bool) -> Dictionary:
	if app_guid == "":
		return _fail("Set gipity/app_guid in Project Settings.", 0)
	var http := HTTPRequest.new()
	http.timeout = REQUEST_TIMEOUT_S
	add_child(http)
	var headers := PackedStringArray(["Content-Type: application/json", "Accept: application/json"])
	if auth and _token != "":
		headers.append("Authorization: Bearer " + _token)
	var payload := "" if body == null else JSON.stringify(body)
	var err := http.request(api_base + "/api/" + app_guid + path, headers, method, payload)
	if err != OK:
		http.queue_free()
		return _fail("Request didn't start (%s)." % error_string(err), 0, true)
	var out: Array = await http.request_completed
	http.queue_free()
	var result: int = out[0]
	var code: int = out[1]
	var raw: PackedByteArray = out[3]
	if result != HTTPRequest.RESULT_SUCCESS:
		return _fail("Couldn't reach Gipity (network result %d)." % result, 0, true)
	var parsed = JSON.parse_string(raw.get_string_from_utf8()) if raw.size() > 0 else null
	if code >= 200 and code < 300:
		var data = parsed.get("data") if parsed is Dictionary else parsed
		return _ok(data, code)
	var message := "HTTP %d" % code
	var err_code := ""
	if parsed is Dictionary and parsed.get("error") is Dictionary:
		message = str(parsed.error.get("message", message))
		err_code = str(parsed.error.get("code", ""))
	return _fail(message, code, code >= 500, err_code)


func _ok(data, status: int) -> Dictionary:
	return {"ok": true, "data": data, "error": "", "code": "", "status": status, "offline": false}


func _fail(message: String, status: int, offline := false, code := "") -> Dictionary:
	return {"ok": false, "data": null, "error": message, "code": code, "status": status, "offline": offline}


func _steam() -> Object:
	if steam_override != null:
		return steam_override
	if Engine.has_singleton("Steam"):
		return Engine.get_singleton("Steam")
	return null


## A Web API ticket for STEAM_TICKET_IDENTITY, hex-encoded.
func _steam_ticket() -> Dictionary:
	var steam := _steam()
	if steam == null:
		return _fail("Steam isn't available. Add GodotSteam and initialize it before signing in.", 0)
	var tickets: Array = []
	var on_ticket := func(handle, result, _size, buffer) -> void:
		tickets.append({"handle": handle, "result": result, "buffer": buffer})
	steam.connect("get_ticket_for_web_api", on_ticket)
	var handle = steam.call("getAuthTicketForWebApi", STEAM_TICKET_IDENTITY)
	var deadline := Time.get_ticks_msec() + STEAM_TICKET_TIMEOUT_MS
	var mine = null
	while mine == null and Time.get_ticks_msec() < deadline:
		for t in tickets:
			if t.handle == handle:
				mine = t
		if mine == null:
			await get_tree().process_frame
	steam.disconnect("get_ticket_for_web_api", on_ticket)
	if mine == null:
		return _fail("Steam didn't return a ticket. Is Steam.run_callbacks() called every frame?", 0)
	if int(mine.result) != STEAM_RESULT_OK:
		return _fail("Steam refused the ticket (result %d)." % int(mine.result), 0)
	var bytes: PackedByteArray = mine.buffer if mine.buffer is PackedByteArray else PackedByteArray(mine.buffer)
	return _ok(bytes.hex_encode(), 0)


func _device_secret() -> String:
	var cfg := ConfigFile.new()
	if cfg.load(DEVICE_FILE) == OK:
		var saved := str(cfg.get_value("guest", "secret", ""))
		if saved.length() >= 32:
			return saved
	DirAccess.make_dir_recursive_absolute(DATA_DIR)
	var secret := Crypto.new().generate_random_bytes(32).hex_encode()
	cfg.set_value("guest", "secret", secret)
	cfg.save(DEVICE_FILE)
	return secret


func _load_queue() -> Array:
	if not FileAccess.file_exists(QUEUE_FILE):
		return []
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(QUEUE_FILE))
	return parsed if parsed is Array else []


func _save_queue(q: Array) -> void:
	DirAccess.make_dir_recursive_absolute(DATA_DIR)
	var f := FileAccess.open(QUEUE_FILE, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(q))
