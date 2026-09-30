# Gip Racer (demo)

A tiny top-down lap racer that uses every part of the Gipity addon: Steam or guest sign-in, a leaderboard with checkpoint splits and ghosts, the weekly and around-me views, racing the leader's ghost, and the game's own server function (`race-finish`) writing to its own database.

## Run it

1. Set up the backend once (from `demo/backend/`, with the `gipity` CLI):
   ```bash
   gipity init gip-racer && gipity add api && gipity add leaderboard
   gipity project auth app
   gipity deploy dev
   ```
   `backend/` already holds the game's function (`functions/race-finish.js`), migration (`migrations/001-gip-racer.sql`) and test; `gipity add` leaves them alone. It also holds a copy of the leaderboard kit's functions and migrations so you can read them here; `gipity add leaderboard` writes the current version over them.
2. Put the project guid (`gipity project info`) in **Project Settings > gipity/app_guid**.
3. Open `demo/` in Godot 4.7 and press Play. Arrow keys or WASD to drive, G to race the leader's ghost, Tab for the all-time board, R to restart the lap.

With GodotSteam installed and Steam running, it signs in with Steam; otherwise as a guest.

## Headless proof run

```bash
godot --headless --path demo -- --autopilot
```

Drives two laps by itself against the live backend and checks sign-in, lap submission, the function log, the weekly board, the ghost round trip and cheat rejection. It exits 0 on success (`AUTOPILOT PASS: 10/10 checks`).
