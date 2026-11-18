# gipity_device: Gipity for Python devices

A small Python client for a device or script that talks to a [Gipity](https://gipity.ai) app: a Raspberry Pi in a cupboard, a controller behind a home router, a cron job, a CI step. It uses a project API key and gives you:

- `client.fn.call(name, params)`: call your app's functions.
- `client.records.get/list/create`: read and write Records tables.
- `client.subscribe(table, on_event, ...)`: follow a table's change stream and never miss an event, across dropped connections, silent NAT timeouts and process restarts.
- `client.upload(path)`: upload a file of any size, streamed from disk.
- `verify_approval(...)` and `client.consume_approval(...)`: check a passkey-signed approval offline before acting on it.

Python 3.10+, two dependencies (`httpx`, `cryptography`).

This folder lives in the [Gipity registry](https://github.com/GipityAI/registry/tree/main/examples/python). It's sample code you install from the folder or copy by hand, not something `gipity add` installs.

## Install

```bash
pip install "gipity-device @ git+https://github.com/GipityAI/registry.git#subdirectory=examples/python"
```

Or clone the registry and `pip install ./examples/python`, or copy the `gipity_device/` folder into your project and `pip install httpx cryptography`.

## Quick start

```python
from gipity_device import Client

with Client("<APP_GUID>", "<API_KEY>") as client:
    print(client.fn.call("heartbeat", {"device": "boiler", "temp_c": 61}))
    page = client.records.list("commands", filter="device:eq:boiler", sort="id:desc", limit=10)
    print(page.total, page.rows)
    stored = client.upload("/var/log/boiler/today.csv", table="logs")
    print(stored["guid"], stored["url"])
```

`APP_GUID` comes from `gipity project info`, the key from `gipity key create` (it's printed once).

## Walkthrough: a device behind NAT that must never miss a command, and never act without a passkey approval

A boiler controller sits on a home network. You can't reach it from outside, it can't take incoming connections, and the home router silently drops idle connections. Commands come from a phone app. Two rules:

1. **Never miss a command**, even if the Wi-Fi drops for an hour or the Pi reboots.
2. **Never act without the owner's passkey approval** of that exact command. A stolen API key, a bug in the app, or even a compromised server must not be able to turn the boiler up.

The pieces: an append-only `commands` table the device follows over the Records change stream, a passkey approval per command, and a `command_results` table the device writes back to.

### 1. The backend

`migrations/001-commands.sql`:

```sql
CREATE TABLE commands (
  id          BIGSERIAL PRIMARY KEY,
  device      TEXT NOT NULL,
  payload     JSONB NOT NULL,      -- the exact action, e.g. {"cmd":"set","target":65,"unit":"C"}
  approval_id TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE command_results (
  id          BIGSERIAL PRIMARY KEY,
  command_id  BIGINT NOT NULL REFERENCES commands(id),
  status      TEXT NOT NULL,       -- done | refused | failed
  detail      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

In `gipity.yaml`, declare both as Records tables, append-only so the command log can't be edited after the fact:

```yaml
- name: records
  type: records
  tables:
    - { table: commands, auth_level: member, append_only: true }
    - { table: command_results, auth_level: member, append_only: true }
```

and a function the phone app calls, `functions/request-command.js` (declared with `auth: user`, `services: ['approval']`, `tables: ['commands']`):

```js
export default async function (ctx, { approval, records }) {
  const { device, payload, summary } = ctx.body;  // payload: {"cmd":"set","target":65,"unit":"C"}
  const req = await approval.request({ summary, payload, approver: 'owner', ttlSeconds: 600 });
  // Through records.create, not db.query, so the row goes out on the change stream.
  const row = await records.create('commands', { device, payload, approval_id: req.id });
  return { command: row.id, approveUrl: req.approveUrl, delivery: req.delivery };
}
```

The owner gets a push, opens the approve page, reads the exact payload and confirms with Face ID or their security key. See the `app-approvals` skill for the whole flow.

### 2. A key that can only do this one job

```bash
gipity key create "boiler-pi" --role editor \
  --tables commands:read,command_results:write \
  --approvals read
```

The key can read commands, write results, and read and consume approvals. Nothing else: no other tables, no functions, no files. Even with this key, an attacker can't make the device act, because every command needs a passkey signature the key can't produce.

### 3. Pin the approver's passkey once

The device must check signatures against a key it already trusts, not one the server hands it. Approve one test command, then print its proof's public key:

```bash
gipity approval show <ap_id> --json   # proof.publicKeyJwk
```

Check it with the approver (it's their passkey), and save it on the device as `/etc/boiler/approver.jwk`. If they add a new passkey, pin that one too.

### 4. The device

```python
import json
import logging
import time
from pathlib import Path

from gipity_device import Client, GipityError, RecordEvent, payload_hash, verify_approval

log = logging.getLogger("boiler")
APP_GUID = "<APP_GUID>"
API_KEY = Path("/etc/boiler/api-key").read_text().strip()
PINNED = json.loads(Path("/etc/boiler/approver.jwk").read_text())
CURSOR = "/var/lib/boiler/commands.cursor"

client = Client(APP_GUID, API_KEY)


def set_boiler(target: int, unit: str) -> None:
    ...  # drive the relay


def already_handled(command_id: int) -> bool:
    return client.records.list("command_results", filter=f"command_id:eq:{command_id}", limit=1).total > 0


def report(command_id: int, status: str, detail: str = "") -> None:
    client.records.create("command_results", {"command_id": command_id, "status": status, "detail": detail})


def wait_for_decision(approval_id: str) -> dict:
    """Poll until the owner approves or denies (or it expires)."""
    while True:
        approval = client.get_approval(approval_id)
        if approval["status"] != "pending":
            return approval
        time.sleep(3)


def handle(command: dict) -> None:
    if command["device"] != "boiler" or already_handled(command["id"]):
        return
    payload = command["payload"]          # the exact action this device will run
    approval = wait_for_decision(command["approval_id"])

    result = verify_approval(approval, payload, PINNED)
    if not result.ok:
        report(command["id"], "refused", "failed checks: " + ", ".join(result.failed))
        return
    # Single use: act only if THIS call consumed it.
    if not client.consume_approval(approval["id"], payload_hash(payload)):
        report(command["id"], "refused", "approval was already used or expired")
        return
    try:
        set_boiler(payload["target"], payload["unit"])
    except Exception as exc:
        report(command["id"], "failed", str(exc))
        raise
    report(command["id"], "done")


def on_event(event: RecordEvent) -> None:
    if event.type == "record.created" and event.record is not None:
        handle(event.record)


def resync(reason: str) -> None:
    """The stream lost track (offline for over 24 hours): re-read recent commands."""
    log.warning("stream reset (%s); re-reading recent commands", reason)
    for command in reversed(client.records.list("commands", filter="device:eq:boiler", sort="id:desc", limit=100).rows):
        handle(command)


client.subscribe(
    "commands", on_event,
    filter="device:eq:boiler",
    cursor_file=CURSOR,
    on_reset=resync,
    on_error=lambda exc: log.warning("stream: %s (reconnecting)", exc),
).run()   # blocks forever; run it under systemd with Restart=always
```

### Why it never misses a command

- The stream has an id on every event. The subscription writes the id of each event to `CURSOR` (atomically) **after** `on_event` returns, and sends it back as `Last-Event-ID` on every reconnect, so the server replays everything after it, in order, with no gap.
- A home router that silently drops the connection shows up as silence: the server sends a keepalive every 15 seconds, and after `heartbeat_timeout` (35 s) without a byte the subscription reconnects, with exponential backoff and jitter while the network is down.
- A reboot is just a reconnect: the cursor file is still there.
- If `on_event` raises (the relay board is unplugged), the cursor doesn't move and the same command comes again after the backoff. Delivery is at least once, which is why `handle` first checks `command_results`.
- The server keeps missed events for 24 hours. A device offline longer gets `event: reset`; `on_reset` re-reads recent commands from the table, and the stream carries on. Without `on_reset`, a reset raises instead of quietly skipping events.
- A command row too large to send inline arrives with `record_omitted`, and the client fetches it by id before calling `on_event`, so `event.record` is always the full row.

### Why it never acts without approval

- `verify_approval` recomputes everything itself: the hash of the payload the device is about to run, the WebAuthn challenge, the origin, the relying-party hash, the user-present and user-verified flags, and the passkey signature against the **pinned** key. A server that changed the payload, swapped the key, or replayed another approval fails these checks.
- `consume_approval` spends the approval exactly once. A second delivery of the same command, or a replay by someone holding the key, gets `False`.
- If the device crashes after consuming but before acting, the command is not run (the approval is spent) and no result is written. That's the safe side: the owner sees no `done` result and asks again.
- The approval expires (`ttlSeconds`), and `verify_approval` refuses an expired one even if the server says otherwise.

## Reference

### `Client(app_guid, api_key, base_url="https://a.gipity.ai", *, timeout=30, max_retries=4, backoff=0.5, max_backoff=8)`

Sends the key as `X-Api-Key` to the app API and never to presigned storage URLs. Methods raise `GipityError` (`status`, `code`, `message`) when the API refuses a request. Retries, with backoff and jitter:

- a request that never reached the server (connect error or timeout), any method;
- a 429 refused before running (`Retry-After` honored), but not a function's own `LIMIT_EXCEEDED`;
- a `GET` that got 502/503/504 or lost its response.

A `POST` whose response was lost is not repeated, because it may already have run.

| Call | Returns |
|---|---|
| `client.fn.call(name, params=None)` | the function's value, unwrapped |
| `client.records.get(table, id)` | the row (404 raises) |
| `client.records.list(table, filter=, any=, sort=, limit=, offset=, fields=, q=)` | `RecordPage(rows, total)` |
| `client.records.create(table, data)` | the created row |
| `client.upload(source, filename=, content_type=, public=False, table=, record_id=, path="uploads", size=)` | the stored file `{guid, name, size, content_type, url, ...}` |
| `client.get_approval(id)` | `{id, status, payloadHash, expiresAt, approver, resolvedAt, consumedAt, proof}` |
| `client.consume_approval(id, payload_hash)` | `True` only if this call consumed it |
| `client.subscribe(table, on_event, last_event_id=None, **options)` | a `Subscription` |

### `Subscription`

`run()` blocks until `stop()`; `start()` runs it in a daemon thread (`join()` waits). Options:

- `cursor_file`: path of the cursor file (resume after restarts). `last_event_id` overrides it on startup.
- `save_cursor`: a callback given each finished event id, to keep the cursor elsewhere.
- `on_reset(reason)`: re-sync after a reset. Required to survive one.
- `on_error(exc)`: called before each reconnect, for logging.
- `filter`, `any`, `fields`: Records query params that narrow the stream.
- `heartbeat_timeout` (35 s), `initial_backoff` (1 s), `max_backoff` (30 s).

A bad key, no access, or an unknown table (400/401/403/404) ends `run()` with `GipityError`; everything else reconnects.

`RecordEvent` has `id`, `type` (`record.created`, `record.updated`, `record.deleted`), `table`, `record_id`, `record`, `changes` (updates), `omitted`, and `data` (the raw payload).

### Uploads

`upload` runs `POST /uploads/init`, then `PUT`s the bytes straight to storage (one request, or one per part for very large files), then `POST /uploads/complete`. It streams 1 MiB at a time and re-sends a failed part. Pass a path or a seekable binary file; a non-seekable stream needs `size=` and is sent once, without retries. A scoped key needs `--files write`.

### Approvals and canonical JSON

`verify_approval(approval, payload, pinned_public_key_jwk, origin="https://a.gipity.ai", *, now=None)` returns `VerifyResult(ok, pinned, checks)`; `result.failed` names the failed checks. It accepts the `data` object `get_approval` returns or the whole `{"data": ...}` body. Pass `None` as the key only while pinning (the result then says `pinned=False`). ES256, EdDSA and RS256 passkeys are supported.

`canonical_json(value)` and `payload_hash(value)` produce exactly the bytes the server hashes (RFC 8785, with JavaScript's number and string formatting and UTF-16 key order). Keep payloads to strings, integers, booleans and null so every language agrees.

## Tests

```bash
uv run --extra test pytest        # or: pip install -e '.[test]' && pytest
```

The tests run against a local mock of the Gipity API (`tests/mock_server.py`): stream replay, reset, reconnect after silence, omitted rows, at-least-once redelivery, retries, single and multipart uploads, and approval verification against a real proof produced by the platform's own test suite (the same fixture the `gipity approval verify` command is tested with). The registry gate (`node scripts/test.mjs`) runs them.
