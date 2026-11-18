extends Node
## Gipity backend client, registered as the "Gipity" autoload by the plugin.
##
## Sign a player in (Steam or guest), then call your app's functions and the
## leaderboard kit. Every call returns a Result dictionary and never throws:
##   { ok: bool, data: Variant, error: String, code: String, status: int, offline: bool }
## `error` is a message to show; `code` is the server's machine-readable code to
## branch on (e.g. DISPLAY_NAME_REJECTED, DISPLAY_NAME_TAKEN, PLAYER_CLEANUP_FAILED,
## GAME_VERSION_TOO_OLD), "" when there is none. `offline` is true when the
## server couldn't be reached, so the game can carry on without its online features.
##
##   await Gipity.sign_in_steam()            # or: await Gipity.sign_in_guest("Racer")
##   var r = await Gipity.call_function("my-function", {"x": 1})
##   var s = await Gipity.leaderboard.submit("oval-1:lap", 31250, {"splits": [10400, 21010, 31250]})
##
## Project Settings: gipity/app_guid (required), gipity/api_base.
## Leaderboard runs carry application/config/version as their game version.
##
## Sessions: sign-in returns a 1-hour access token and a 60-day refresh token.
## The addon renews the access token with the refresh token shortly before it
## expires, and once more when a call comes back 401; if the refresh token is no
## longer valid it signs in again the way the player last did (Steam or guest).
## sign_out() revokes the refresh token on the server.

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
## Renew the access token this long before it expires.
const TOKEN_RENEW_MARGIN_S := 60.0

var app_guid := ""
var api_base := "https://a.gipity.ai"
## Sent with every leaderboard run. Defaults to application/config/version.
var game_version := ""
## { guid, displayName, avatarUrl, provider, providerUserId, isNew, nameConflict }
## once signed in. nameConflict is true when the app requires unique names and
## the player isn't showing a name of their own (their Steam persona is taken, so
## they got "<persona> #1234", or they share a name another player had first):
## ask them to pick one with check_name() and rename_player().
var player: Dictionary = {}
## Leaderboard kit client: submit, top, around_me, me, friends, friends_steam, ghost, boards.
var leaderboard: LeaderboardClient
## A stand-in for the GodotSteam singleton (tests, or a custom Steam wrapper).
var steam_override: Object = null

var _token := ""
## Local clock time to renew the access token by (expiry minus the margin).
var _token_expires_at := 0.0
var _refresh_token := ""
## Local clock time the refresh token stops working.
var _refresh_expires_at := 0.0
var _renewing := false
var _sign_in_method := ""
var _guest_name := ""
var _flushing := false

signal _renew_finished(result: Dictionary)


func _ready() -> void:
	app_guid = str(ProjectSettings.get_setting("gipity/app_guid", ""))
	api_base = str(ProjectSettings.get_setting("gipity/api_base", "https://a.gipity.ai")).trim_suffix("/")
	game_version = str(ProjectSettings.get_setting("application/config/version", ""))
	leaderboard = LeaderboardClient.new(self)


## True while the player holds a current access token. Once it lapses the next
## call renews it (with the refresh token, or by signing in again).
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
## A refused name fails with code DISPLAY_NAME_REJECTED, and a name another
## player has (apps with unique names) with DISPLAY_NAME_TAKEN: ask for another.
func sign_in_guest(display_name := "") -> Dictionary:
	_guest_name = display_name
	var body := {"deviceSecret": _device_secret()}
	if display_name != "":
		body["displayName"] = display_name
	var res := await _request(HTTPClient.METHOD_POST, "/auth/guest", body, false)
	return _accept_session(res, "guest")


## Attach the running Steam account to the signed-in guest player.
func link_steam() -> Dictionary:
	if _sign_in_method != "guest":
		return _fail("Sign in as a guest before linking Steam.", 0)
	if not is_signed_in():
		var renewed := await _renew()
		if not renewed.ok:
			return renewed
	var ticket := await _steam_ticket()
	if not ticket.ok:
		return ticket
	var res := await _request(HTTPClient.METHOD_POST, "/auth/steam", {"ticket": ticket.data, "link": true}, true)
	return _accept_session(res, "steam")


## Sign out on this device: forget the session and revoke its refresh token on
## the server (best effort; the local sign-out always happens).
func sign_out() -> void:
	_revoke_refresh_token(_refresh_token)
	_clear_session()


func _clear_session() -> void:
	_token = ""
	_token_expires_at = 0.0
	_refresh_token = ""
	_refresh_expires_at = 0.0
	_sign_in_method = ""
	player = {}
	signed_out.emit()


## Set the signed-in player's name in this game; "" or null clears it.
## data: { guid, displayName, nameConflict }. For a Steam player this name wins
## over their Steam persona on every sign-in; clearing it goes back to the persona.
## Fails with code DISPLAY_NAME_REJECTED for a refused name, or DISPLAY_NAME_TAKEN
## when the app requires unique names and another player has it (show error, ask
## for another; check_name() offers free ones).
func rename_player(display_name = null) -> Dictionary:
	var new_name = null if display_name == null else str(display_name)
	var res := await _authed(HTTPClient.METHOD_PATCH, "/auth/player", {"displayName": new_name})
	if res.ok and res.data is Dictionary:
		var saved = res.data.get("displayName")
		player["displayName"] = saved
		player["nameConflict"] = bool(res.data.get("nameConflict", false))
		if _sign_in_method == "guest":
			_guest_name = "" if saved == null else str(saved)
	return res


## Is a display name free in this app? Works before sign-in (for a name field
## on the first screen); when signed in, the player's own name counts as free.
## data: { name, available, uniqueNames, suggestions }, where suggestions are
## free names close to it that pass the filter. A refused name fails with code
## DISPLAY_NAME_REJECTED. The server allows 30 checks a minute per IP address,
## so check when the player pauses typing or presses a button, not every keystroke.
func check_name(display_name: String) -> Dictionary:
	return await _request(HTTPClient.METHOD_GET, "/auth/player/name-available?name=" + display_name.uri_encode(), null, is_signed_in())


## Permanently delete the signed-in player (account deletion requests).
## Code PLAYER_CLEANUP_FAILED means the app couldn't erase the player's data, so
## nothing was deleted: the player stays signed in, and calling again retries.
func delete_player() -> Dictionary:
	var res := await _authed(HTTPClient.METHOD_DELETE, "/auth/player", null)
	if res.ok:
		if _sign_in_method == "guest":
			DirAccess.remove_absolute(DEVICE_FILE)
		# The server already ended every session of the deleted player.
		_clear_session()
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
	if _flushing or _sign_in_method == "":
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
		await _renew()
	var sent_token := _token
	var res := await _request(method, path, body, true)
	# The access token expired or was revoked mid-session: renew once and retry.
	if res.status == 401 and _sign_in_method != "":
		# Another call may already have renewed it while this one was in flight.
		var again := _ok(null, 0) if _token != sent_token and _token != "" else await _renew()
		if again.ok:
			res = await _request(method, path, body, true)
	return res


## Get a fresh access token: with the refresh token while it's valid, else by
## signing in again. One renewal at a time: a refresh token is single-use, so a
## second concurrent refresh with it would look like theft and end the session.
func _renew() -> Dictionary:
	if _renewing:
		return await _renew_finished
	_renewing = true
	var res := await _renew_once()
	_renewing = false
	_renew_finished.emit(res)
	return res


func _renew_once() -> Dictionary:
	if _refresh_token != "" and Time.get_unix_time_from_system() < _refresh_expires_at:
		var res := await _request(HTTPClient.METHOD_POST, "/auth/refresh", {"refreshToken": _refresh_token}, false)
		if res.ok and res.data is Dictionary and _store_tokens(res.data):
			return _ok(player, res.status)
		if res.offline:
			return res
	# No usable refresh token (expired, revoked, signed out everywhere).
	_refresh_token = ""
	return await _reauth()


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
	var previous_refresh := _refresh_token
	if not _store_tokens(data):
		return _fail("Sign-in response had no tokens.", res.status)
	# Signing in again (or linking Steam) replaces the old session: revoke it.
	if previous_refresh != "" and previous_refresh != _refresh_token:
		_revoke_refresh_token(previous_refresh)
	_sign_in_method = method
	player = data.get("user", {})
	res.data = player
	signed_in.emit(player)
	flush_queue()
	return res


## Keep a token pair from a sign-in or refresh. Lifetimes are measured on the
## server's clock (the access token's iat, and the expiry times it sent), then
## counted from now on ours, so a wrong local clock can't break renewal.
func _store_tokens(data: Dictionary) -> bool:
	var access := str(data.get("accessToken", ""))
	var refresh := str(data.get("refreshToken", ""))
	if access == "" or refresh == "":
		return false
	var claims := _jwt_claims(access)
	var server_now := float(claims.get("iat", 0))
	var access_exp := float(claims.get("exp", 0))
	var refresh_exp := _iso_to_unix(str(data.get("refreshTokenExpiresAt", "")))
	if server_now <= 0 or access_exp <= server_now or refresh_exp <= server_now:
		return false
	var now := Time.get_unix_time_from_system()
	_token = access
	_token_expires_at = now + (access_exp - server_now) - TOKEN_RENEW_MARGIN_S
	_refresh_token = refresh
	_refresh_expires_at = now + (refresh_exp - server_now)
	return true


## Revoke a refresh token on the server. Fire and forget: nothing waits on it.
func _revoke_refresh_token(token: String) -> void:
	if token == "":
		return
	_request(HTTPClient.METHOD_POST, "/auth/signout", {"refreshToken": token}, false)


## The payload of a JWT, without verifying it (the server does that).
static func _jwt_claims(token: String) -> Dictionary:
	var parts := token.split(".")
	if parts.size() != 3:
		return {}
	var b64 := parts[1].replace("-", "+").replace("_", "/")
	while b64.length() % 4 != 0:
		b64 += "="
	var parsed = JSON.parse_string(Marshalls.base64_to_utf8(b64))
	return parsed if parsed is Dictionary else {}


## Unix seconds from an ISO 8601 UTC time like 2026-11-18T17:05:00.000Z.
static func _iso_to_unix(iso: String) -> float:
	if iso.length() < 19:
		return 0.0
	return float(Time.get_unix_time_from_datetime_string(iso.substr(0, 19)))


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
