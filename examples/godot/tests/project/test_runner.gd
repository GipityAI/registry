extends SceneTree
## Drives the Gipity addon against tests/mock_server.mjs. Exit code = failures.

class FakeSteam extends RefCounted:
	signal get_ticket_for_web_api(auth_ticket: int, result: int, ticket_size: int, ticket_buffer: PackedByteArray)
	var identities: Array = []
	var result := 1

	func getAuthTicketForWebApi(identity: String) -> int:
		identities.append(identity)
		# Another caller's ticket arrives first; the addon must wait for its own.
		get_ticket_for_web_api.emit.call_deferred(3, 1, 2, PackedByteArray([0xff, 0xff]))
		get_ticket_for_web_api.emit.call_deferred(7, result, 5, PackedByteArray([0xde, 0xad, 0xbe, 0xef, 0x01]))
		return 7

	func getFriendCount(_flags: int) -> int:
		return 2

	func getFriendByIndex(i: int, _flags: int) -> int:
		return [76561190000000002, 76561190000000003][i]


var g: Node
var failures := 0
var base := ""
var dropped: Array = []


func _initialize() -> void:
	base = "http://127.0.0.1:" + OS.get_environment("MOCK_PORT")
	ProjectSettings.set_setting("gipity/app_guid", "app_test")
	ProjectSettings.set_setting("gipity/api_base", base)
	g = load("res://addons/gipity/gipity.gd").new()
	root.add_child(g)
	_run.call_deferred()


func check(cond: bool, label: String, detail = "") -> void:
	if cond:
		print("ok   ", label)
	else:
		failures += 1
		print("FAIL ", label, "  ", detail)


func control(body: Dictionary) -> void:
	var http := HTTPRequest.new()
	root.add_child(http)
	http.request(base + "/__control", PackedStringArray(["Content-Type: application/json"]), HTTPClient.METHOD_POST, JSON.stringify(body))
	await http.request_completed
	http.queue_free()


func _run() -> void:
	check(g.game_version == "9.9.9-test", "game version falls back to application/config/version", g.game_version)

	var r = await g.call_function("echo", {})
	check(not r.ok and r.status == 401, "calling before sign-in fails cleanly", r)

	r = await g.sign_in_steam()
	check(not r.ok and "Steam isn't available" in r.error, "Steam sign-in without GodotSteam explains itself", r)

	r = await g.sign_in_guest("darn it")
	check(not r.ok and r.status == 400 and r.code == "DISPLAY_NAME_REJECTED" and not r.offline and not g.is_signed_in(),
		"a refused guest name fails with code DISPLAY_NAME_REJECTED", r)

	r = await g.sign_in_guest("Guesty")
	check(r.ok and g.is_signed_in() and g.player.displayName == "Guesty" and r.code == "", "guest sign-in", r)
	var first_guid = g.player.guid
	g.sign_out()
	r = await g.sign_in_guest("Guesty")
	check(r.ok and g.player.guid == first_guid and not g.player.isNew, "the device secret persists: same guest again", r)

	r = await g.rename_player("Speedy")
	check(r.ok and r.data.displayName == "Speedy" and g.player.displayName == "Speedy", "rename_player renames the guest", r)
	r = await g.rename_player("darn good")
	check(not r.ok and r.status == 400 and r.code == "DISPLAY_NAME_REJECTED" and g.player.displayName == "Speedy",
		"a refused rename keeps the old name and returns the code", r)
	r = await g.rename_player(null)
	check(r.ok and r.data.displayName == null and g.player.displayName == null, "rename_player(null) clears the name", r)
	await g.rename_player("Guesty")
	g.sign_out()
	r = await g.sign_in_guest("Guesty")
	check(r.ok and g.player.displayName == "Guesty", "the new name sticks across sign-ins", r)

	r = await g.call_function("echo", {"n": 3})
	check(r.ok and r.data.you == first_guid and int(r.data.got.n) == 3, "call_function sends the token and unwraps data", r)

	r = await g.call_function("missing-fn", {})
	check(not r.ok and r.status == 404 and "not found" in r.error and r.code == "NOT_FOUND", "server errors come back as messages with their code", r)

	await control({"failNextAuthOn": ["echo"]})
	r = await g.call_function("echo", {})
	check(r.ok and r.data.you == first_guid, "a revoked token re-signs in once and retries", r)

	var fake := FakeSteam.new()
	g.steam_override = fake
	r = await g.link_steam()
	check(r.ok and g.player.guid == first_guid and g.player.provider == "steam", "link_steam keeps the guest player", r)
	check(fake.identities == ["gipity"], "the Steam ticket is requested for the gipity identity", fake.identities)
	r = await g.rename_player("Nope")
	check(not r.ok and r.status == 409 and r.code == "CONFLICT" and g.player.displayName == "Racer X", "a Steam player can't be renamed (409 CONFLICT)", r)

	g.sign_out()
	r = await g.sign_in_steam()
	check(r.ok and g.player.displayName == "Racer X" and g.player.guid == first_guid, "Steam sign-in picks its own ticket and reaches the linked player", r)

	fake.result = 2
	g.sign_out()
	r = await g.sign_in_steam()
	check(not r.ok and "refused the ticket" in r.error, "a Steam ticket failure is reported", r)
	fake.result = 1
	await g.sign_in_steam()

	var ghost_bytes := PackedByteArray([1, 2, 3, 250, 251, 252])
	r = await g.leaderboard.submit("oval-1:lap", 31250, {"ruleset": "a1f09c", "splits": [10400, 21010, 31250], "ghost": ghost_bytes})
	check(r.ok and r.data.accepted and int(r.data.rank) == 1, "leaderboard submit", r)
	r = await g.leaderboard.ghost("lbe_1")
	check(r.ok and r.data == ghost_bytes, "a ghost round-trips as bytes", r)

	r = await g.leaderboard.submit("arcade:score", 4200, {"tiebreak": 61000})
	check(r.ok and r.data.accepted, "submit passes a tiebreak through", r)

	r = await g.leaderboard.submit("oval-1:lap", 5)
	check(r.ok and not r.data.accepted and r.data.reason != "", "a rejected run is ok:true with a reason", r)

	r = await g.leaderboard.submit("versioned:lap", 40000)
	check(r.ok and r.data.accepted and r.code == "", "submit sends application/config/version by default", r)
	r = await g.leaderboard.submit("versioned:lap", 40000, {"game_version": "1.9.0"})
	check(r.ok and not r.data.accepted and r.code == "GAME_VERSION_TOO_OLD" and r.data.reason != "", "an old build is refused with code GAME_VERSION_TOO_OLD", r)
	r = await g.leaderboard.submit("versioned:lap", 40000, {"game_version": "banana"})
	check(r.ok and not r.data.accepted and r.code == "GAME_VERSION_INVALID", "a garbage version is refused with code GAME_VERSION_INVALID", r)
	g.game_version = ""
	r = await g.leaderboard.submit("oval-1:lap", 77777)
	check(r.ok and r.data.accepted, "a build with no version still submits (gameVersion omitted)", r)
	g.game_version = "9.9.9-test"

	r = await g.leaderboard.top("oval-1:lap", {"period": "week"})
	check(r.ok and r.data.period == "week" and r.data.entries.size() == 1, "leaderboard top", r)

	r = await g.leaderboard.top("")
	check(not r.ok and "required" in r.error, "kit input errors surface as failures", r)

	r = await g.leaderboard.friends_steam("oval-1:lap")
	check(r.ok and r.data.echoIds == ["76561190000000002", "76561190000000003"] and r.data.provider == "steam", "friends_steam sends the Steam friend ids as strings", r)

	g.queued_run_dropped.connect(func(run, code, reason): dropped.append({"run": run, "code": code, "reason": reason}))
	g.api_base = "http://127.0.0.1:9"
	r = await g.leaderboard.submit("oval-1:race", 99999)
	check(not r.ok and r.offline and r.get("queued", false), "offline submit is queued", r)
	await g.leaderboard.submit("versioned:lap", 41000, {"game_version": "1.0.0"})
	await g.leaderboard.submit("versioned:lap", 42000, {"game_version": "junk"})
	check(g._load_queue().size() == 3, "three runs wait in the queue", g._load_queue())
	g.api_base = base
	g.sign_out()
	await g.sign_in_guest("Guesty")
	await create_timer(1.0).timeout
	check(g._load_queue().is_empty(), "the queue flushes after the next sign-in", g._load_queue())
	var codes := dropped.map(func(d): return d.code)
	check(codes == ["GAME_VERSION_TOO_OLD", "GAME_VERSION_INVALID"] and int(dropped[0].run.score) == 41000 and dropped[0].reason != "",
		"queued runs refused for their version are dropped and reported", dropped)

	await control({"failNextDelete": true})
	r = await g.delete_player()
	check(not r.ok and r.status == 502 and r.code == "PLAYER_CLEANUP_FAILED" and not r.offline and g.is_signed_in(),
		"a failed player cleanup keeps the session and is not offline", r)
	r = await g.call_function("echo", {})
	check(r.ok, "the token still works after a failed delete", r)

	r = await g.delete_player()
	check(r.ok and not g.is_signed_in(), "delete_player retried: deletes and signs out", r)

	quit(failures)
