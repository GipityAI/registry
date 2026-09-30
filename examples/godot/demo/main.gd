extends Node2D
## Gip Racer: a tiny top-down lap racer that uses every part of the Gipity addon.
##
## Drive with the arrow keys (or WASD). Each lap is timed with four checkpoint
## splits, recorded as a ghost, submitted to the leaderboard kit, and logged by
## the app's own `race-finish` function. The leader's ghost races with you.
## Keys: G = race the leader's ghost, Tab = week / all-time board, R = restart lap.
##
## Headless proof run: godot --headless --path demo -- --autopilot
## drives two laps by itself, checks every online feature, and exits 0 on success.

const BOARD := "oval:lap"
const RULESET := "v1"
const CENTER := Vector2(640, 380)
const OUTER := Vector2(560, 300)
const INNER := Vector2(330, 120)
const MID := Vector2(445, 210)
const START_ANGLE := PI / 2.0          # the finish line crosses the bottom of the oval
const SECTORS := 4                     # splits per lap; the last one is the lap time
const GHOST_HZ := 30.0
const MAX_SPEED := 520.0
const ACCEL := 420.0
const BRAKE := 700.0
const TURN_RATE := 2.9
const GRASS_DRAG := 2.6

var autopilot := "--autopilot" in OS.get_cmdline_user_args()
## Each autopilot run drives a little differently, so runs don't tie.
var autopilot_line := randf_range(0.35, 0.6)
var autopilot_throttle := randf_range(0.85, 1.0)

var car_pos := Vector2.ZERO
var car_heading := 0.0
var car_speed := 0.0

var racing := false
var lap_time := 0.0
var next_sector := 1
var splits: Array = []
var ghost_frames := PackedFloat32Array()
var ghost_accum := 0.0

var leader_ghost := PackedFloat32Array()
var leader_name := ""
var board_period := "week"
var board_lines: Array = []
var around_lines: Array = []
var best_ms := 0
var last_ms := 0
var rank := 0
var total_laps := 0
var status := "Signing in..."
var laps_done := 0

# Autopilot bookkeeping: what the run proved.
var checks: Array = []


func _ready() -> void:
	reset_car()
	var app_guid := str(ProjectSettings.get_setting("gipity/app_guid", ""))
	if OS.get_environment("GIP_RACER_APP") != "":
		Gipity.app_guid = OS.get_environment("GIP_RACER_APP")
	elif app_guid == "":
		status = "Offline: set gipity/app_guid in Project Settings."
	await sign_in()
	await refresh_board()
	await load_leader_ghost()
	racing = true


func sign_in() -> void:
	var r: Dictionary = await Gipity.sign_in_steam()
	if not r.ok:
		r = await Gipity.sign_in_guest("Racer %04d" % (randi() % 10000))
	if r.ok:
		status = "Signed in as %s (%s)" % [Gipity.player.displayName, Gipity.player.provider]
	else:
		status = "Offline: %s" % r.error
	check("signed in", r.ok, r.error)


func refresh_board() -> void:
	var top: Dictionary = await Gipity.leaderboard.top(BOARD, {"ruleset": RULESET, "period": board_period, "limit": 5})
	board_lines.clear()
	if top.ok:
		for e in top.data.entries:
			board_lines.append("%d. %s  %s" % [int(e.rank), e.displayName, fmt_ms(int(e.score))])
	var near: Dictionary = await Gipity.leaderboard.around_me(BOARD, {"ruleset": RULESET, "period": board_period, "radius": 2})
	around_lines.clear()
	if near.ok and near.data.get("entry") != null:
		rank = int(near.data.entry.rank)
		best_ms = int(near.data.entry.score)
		for e in near.data.entries:
			var me := "> " if e.userGuid == Gipity.player.get("guid", "") else "  "
			around_lines.append("%s%d. %s  %s" % [me, int(e.rank), e.displayName, fmt_ms(int(e.score))])


func load_leader_ghost() -> void:
	var top: Dictionary = await Gipity.leaderboard.top(BOARD, {"ruleset": RULESET, "limit": 1})
	if not top.ok or top.data.entries.is_empty() or not top.data.entries[0].hasGhost:
		return
	var entry: Dictionary = top.data.entries[0]
	var g: Dictionary = await Gipity.leaderboard.ghost(entry.entryId)
	if g.ok:
		leader_ghost = unpack_ghost(g.data)
		leader_name = entry.displayName


func reset_car() -> void:
	car_pos = CENTER + Vector2(0, (OUTER.y + INNER.y) / 2.0)
	car_heading = 0.0      # facing right, i.e. counter-clockwise around the oval
	car_speed = 0.0
	lap_time = 0.0
	next_sector = 1
	splits = []
	ghost_frames = PackedFloat32Array()
	ghost_accum = 0.0


func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	match event.keycode:
		KEY_R:
			reset_car()
		KEY_TAB:
			board_period = "all" if board_period == "week" else "week"
			refresh_board()
		KEY_G:
			load_leader_ghost()


func _physics_process(delta: float) -> void:
	if not racing:
		return
	var throttle := 0.0
	var steer := 0.0
	if autopilot:
		var ahead := progress_angle(car_pos) - autopilot_line
		var target := CENTER + Vector2(cos(ahead_to_theta(ahead)) * MID.x, sin(ahead_to_theta(ahead)) * MID.y)
		var want := (target - car_pos).angle()
		steer = clampf(wrapf(want - car_heading, -PI, PI) * 2.5, -1.0, 1.0)
		throttle = autopilot_throttle
	else:
		throttle = Input.get_axis("ui_down", "ui_up")
		steer = Input.get_axis("ui_left", "ui_right")
		if Input.is_key_pressed(KEY_W): throttle = 1.0
		if Input.is_key_pressed(KEY_S): throttle = -1.0
		if Input.is_key_pressed(KEY_A): steer = -1.0
		if Input.is_key_pressed(KEY_D): steer = 1.0

	if throttle > 0.0:
		car_speed = minf(car_speed + ACCEL * throttle * delta, MAX_SPEED)
	elif throttle < 0.0:
		car_speed = maxf(car_speed - BRAKE * delta, 0.0)
	else:
		car_speed = maxf(car_speed - 120.0 * delta, 0.0)
	car_heading += steer * TURN_RATE * delta * clampf(car_speed / 200.0, 0.0, 1.0)
	if not on_track(car_pos):
		car_speed *= maxf(0.0, 1.0 - GRASS_DRAG * delta)
	car_pos += Vector2.from_angle(car_heading) * car_speed * delta

	lap_time += delta
	ghost_accum += delta
	while ghost_accum >= 1.0 / GHOST_HZ:
		ghost_accum -= 1.0 / GHOST_HZ
		ghost_frames.append_array([car_pos.x, car_pos.y, car_heading])

	var sector := int(progress_angle(car_pos) / (TAU / SECTORS)) % SECTORS
	if sector == next_sector % SECTORS:
		splits.append(int(round(lap_time * 1000.0)))
		if next_sector == SECTORS:
			finish_lap()
		else:
			next_sector += 1
	queue_redraw()


func finish_lap() -> void:
	var lap_ms: int = splits[-1]
	var lap_splits := splits.duplicate()
	var ghost := pack_ghost(ghost_frames)
	last_ms = lap_ms
	laps_done += 1
	# Keep driving: the next lap starts now.
	lap_time = 0.0
	next_sector = 1
	splits = []
	ghost_frames = PackedFloat32Array()
	on_lap(lap_ms, lap_splits, ghost)


func on_lap(lap_ms: int, lap_splits: Array, ghost: PackedByteArray) -> void:
	var sub: Dictionary = await Gipity.leaderboard.submit(BOARD, lap_ms, {"ruleset": RULESET, "splits": lap_splits, "ghost": ghost})
	if sub.ok and sub.data.accepted:
		status = "Lap %s - rank %d%s" % [fmt_ms(lap_ms), int(sub.data.rank), " NEW BEST!" if sub.data.improved.get("all", false) else ""]
	elif sub.code == "GAME_VERSION_TOO_OLD":
		status = "Lap not counted: update Gip Racer to post times"
	elif sub.ok:
		status = "Lap not counted: %s" % sub.data.reason
	else:
		status = "Lap saved offline" if sub.get("queued", false) else "Submit failed: %s" % sub.error
	check("lap %d accepted by the leaderboard" % laps_done, sub.ok and sub.data.get("accepted", false), sub)

	var fin: Dictionary = await Gipity.call_function("race-finish", {"lapMs": lap_ms})
	if fin.ok:
		total_laps = int(fin.data.laps)
	check("lap %d logged by race-finish" % laps_done, fin.ok and int(fin.data.laps) >= 1, fin)
	await refresh_board()
	if autopilot and laps_done >= 2:
		await finish_autopilot(fin)


func finish_autopilot(fin: Dictionary) -> void:
	racing = false
	check("race-finish counted both laps and saw the sign-in provider",
		int(fin.data.laps) >= 2 and str(fin.data.signedInWith) == Gipity.player.get("provider", "?"), fin.data)
	check("the player is on the weekly board", rank >= 1 and best_ms > 0, [rank, best_ms])
	var me: Dictionary = await Gipity.leaderboard.me(BOARD, {"ruleset": RULESET})
	check("the all-time entry has our ghost", me.ok and me.data.entry != null and me.data.entry.hasGhost, me)
	if me.ok and me.data.entry != null:
		var g: Dictionary = await Gipity.leaderboard.ghost(me.data.entry.entryId)
		var frames := unpack_ghost(g.data) if g.ok else PackedFloat32Array()
		check("our ghost downloads and decodes to a lap of frames", frames.size() >= 3 * 30, frames.size())
	var cheat: Dictionary = await Gipity.leaderboard.submit(BOARD, 1500, {"ruleset": RULESET, "splits": [300, 700, 1100, 1500]})
	check("an impossible lap is rejected", cheat.ok and not cheat.data.accepted, cheat)
	var failed := checks.filter(func(c): return not c.ok).size()
	print("AUTOPILOT %s: %d/%d checks, best %s, rank %d, %d laps logged" % [
		"PASS" if failed == 0 else "FAIL", checks.size() - failed, checks.size(), fmt_ms(best_ms), rank, total_laps])
	get_tree().quit(failed)


func check(label: String, ok: bool, detail = null) -> void:
	checks.append({"label": label, "ok": ok})
	if autopilot:
		print(("ok   " if ok else "FAIL ") + label + ("" if ok else "  " + str(detail)))


# --- track geometry --------------------------------------------------------

## Angle travelled from the finish line, counter-clockwise on screen, in [0, TAU).
func progress_angle(p: Vector2) -> float:
	var d := p - CENTER
	var theta := atan2(d.y / MID.y, d.x / MID.x)
	return fposmod(START_ANGLE - theta, TAU)


func ahead_to_theta(progress: float) -> float:
	return START_ANGLE - progress


func on_track(p: Vector2) -> bool:
	var d := p - CENTER
	var outer := pow(d.x / OUTER.x, 2) + pow(d.y / OUTER.y, 2)
	var inner := pow(d.x / INNER.x, 2) + pow(d.y / INNER.y, 2)
	return outer <= 1.0 and inner >= 1.0


# --- ghosts: 30 Hz x/y/heading floats, zstd-compressed, size-prefixed --------

func pack_ghost(frames: PackedFloat32Array) -> PackedByteArray:
	var raw := frames.to_byte_array()
	var out := PackedByteArray()
	out.resize(4)
	out.encode_u32(0, raw.size())
	out.append_array(raw.compress(FileAccess.COMPRESSION_ZSTD))
	return out


func unpack_ghost(bytes: PackedByteArray) -> PackedFloat32Array:
	if bytes.size() < 4:
		return PackedFloat32Array()
	var size := bytes.decode_u32(0)
	return bytes.slice(4).decompress(size, FileAccess.COMPRESSION_ZSTD).to_float32_array()


# --- drawing ---------------------------------------------------------------

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, Vector2(1280, 720)), Color("1f5130"))
	draw_oval(OUTER, Color("3a3a44"))
	draw_oval(INNER, Color("1f5130"))
	var line_top := CENTER + Vector2(0, INNER.y)
	draw_line(line_top, CENTER + Vector2(0, OUTER.y), Color.WHITE, 6)
	for s in range(1, SECTORS):
		var th := ahead_to_theta(s * TAU / SECTORS)
		var dir := Vector2(cos(th), sin(th))
		draw_line(CENTER + dir * INNER, CENTER + dir * OUTER, Color(1, 1, 1, 0.25), 2)

	if leader_ghost.size() >= 3:
		var i := mini(int(lap_time * GHOST_HZ), leader_ghost.size() / 3 - 1) * 3
		draw_car(Vector2(leader_ghost[i], leader_ghost[i + 1]), leader_ghost[i + 2], Color(0.6, 0.8, 1.0, 0.45))
	draw_car(car_pos, car_heading, Color("fea60b"))

	var font := ThemeDB.fallback_font
	var y := 30
	for line in [status, "Lap %s   Last %s   Best %s   Rank %s   Laps logged %d" % [
			fmt_ms(int(lap_time * 1000)), fmt_ms(last_ms), fmt_ms(best_ms), str(rank) if rank else "-", total_laps],
			("Ghost: %s" % leader_name) if leader_name != "" else "Ghost: none yet (G to load)"]:
		draw_string(font, Vector2(20, y), line, HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color.WHITE)
		y += 26
	y = 30
	draw_string(font, Vector2(980, y), "Top 5 (%s) - Tab" % board_period, HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color("fea60b"))
	for line in board_lines + [""] + around_lines:
		y += 24
		draw_string(font, Vector2(980, y), line, HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color.WHITE)


func draw_oval(radii: Vector2, color: Color) -> void:
	var pts := PackedVector2Array()
	for i in 96:
		var a := TAU * i / 96.0
		pts.append(CENTER + Vector2(cos(a) * radii.x, sin(a) * radii.y))
	draw_colored_polygon(pts, color)


func draw_car(p: Vector2, heading: float, color: Color) -> void:
	var f := Vector2.from_angle(heading)
	var r := f.orthogonal()
	draw_colored_polygon(PackedVector2Array([p + f * 16, p - f * 12 + r * 9, p - f * 12 - r * 9]), color)


func fmt_ms(ms: int) -> String:
	return "-" if ms <= 0 else "%d.%03d" % [ms / 1000, ms % 1000]
