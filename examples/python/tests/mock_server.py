"""A small in-process stand-in for the Gipity app API, for the client tests.

It speaks the same wire format as the platform routes the client uses:
``/fn/<name>``, ``/records/<table>[/<id>]``, ``/records/<table>/stream`` (SSE
with ids, ``Last-Event-ID`` replay, ``reset``, keepalives, omitted rows),
``/uploads/init`` + presigned ``PUT`` + ``/uploads/complete``, and
``/approvals/<id>[/consume]``. Tests script its behavior through ``MockState``.
"""
from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional
from urllib.parse import parse_qs, urlsplit

APP = "app_test1"
KEY = "gip_test_key"


@dataclass
class StreamConnection:
    last_event_id: Optional[str]
    params: dict[str, list[str]]


@dataclass
class MockState:
    # functions: name -> list of scripted responses (status, body) popped in order; last one repeats
    functions: dict[str, list[tuple[int, Any]]] = field(default_factory=dict)
    fn_calls: list[tuple[str, Any]] = field(default_factory=list)
    # records: table -> {id: row}
    tables: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    record_gets: list[tuple[str, str]] = field(default_factory=list)
    # scripted failures for GET /records/<table>: statuses returned before success
    list_failures: list[int] = field(default_factory=list)
    list_calls: int = 0
    # stream: ordered (id, event, data) entries; ids are "1-0", "2-0", ...
    events: list[tuple[str, str, Any]] = field(default_factory=list)
    connections: list[StreamConnection] = field(default_factory=list)
    # per connection index: 'close' (send replay then end), 'silent' (send replay then
    # nothing, no keepalives), 'live' (replay, then new events + keepalives until stop)
    stream_plan: list[str] = field(default_factory=list)
    stream_status: Optional[int] = None
    keepalive_s: float = 0.1
    cond: threading.Condition = field(default_factory=threading.Condition)
    stopping: bool = False
    # uploads
    multipart_threshold: int = 10_000
    part_size: int = 4_000
    uploads: dict[str, dict[str, Any]] = field(default_factory=dict)
    storage_puts: list[dict[str, Any]] = field(default_factory=list)
    put_failures: dict[str, int] = field(default_factory=dict)  # url path -> 500s before success
    completed: list[dict[str, Any]] = field(default_factory=list)
    # approvals
    approvals: dict[str, dict[str, Any]] = field(default_factory=dict)
    consumed: list[tuple[str, str]] = field(default_factory=list)
    auth_failures: list[str] = field(default_factory=list)

    def add_event(self, event: str, data: Any) -> str:
        with self.cond:
            event_id = f"{len(self.events) + 1}-0"
            self.events.append((event_id, event, data))
            self.cond.notify_all()
            return event_id


class _Handler(BaseHTTPRequestHandler):
    server: "MockServer"
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args: Any) -> None:  # quiet
        pass

    # ── helpers ──
    @property
    def state(self) -> MockState:
        return self.server.state

    def _json(self, status: int, body: Any, headers: Optional[dict[str, str]] = None) -> None:
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def _error(self, status: int, code: str, message: str, headers: Optional[dict[str, str]] = None) -> None:
        self._json(status, {"error": {"code": code, "message": message}}, headers)

    def _body(self) -> Any:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        return json.loads(raw) if raw else None

    def _authed(self) -> bool:
        if self.headers.get("X-Api-Key") != KEY:
            self.state.auth_failures.append(self.path)
            self._error(401, "UNAUTHORIZED", "Invalid API key")
            return False
        return True

    def _route(self) -> tuple[list[str], dict[str, list[str]]]:
        parts = urlsplit(self.path)
        return [p for p in parts.path.split("/") if p], parse_qs(parts.query)

    # ── verbs ──
    def do_GET(self) -> None:  # noqa: N802
        segs, query = self._route()
        if segs[:2] != ["api", APP]:
            return self._error(404, "NOT_FOUND", "App not found")
        if not self._authed():
            return
        rest = segs[2:]
        if rest[0] == "records" and len(rest) == 3 and rest[2] == "stream":
            return self._stream(rest[1], query)
        if rest[0] == "records" and len(rest) == 2:
            self.state.list_calls += 1
            if self.state.list_failures:
                status = self.state.list_failures.pop(0)
                return self._error(status, "UNAVAILABLE", "try again", {"Retry-After": "0"} if status == 429 else None)
            rows = list(self.state.tables.get(rest[1], {}).values())
            flt = query.get("filter", [None])[0]
            if flt:
                col, op, val = flt.split(":", 2)
                assert op == "eq"
                rows = [r for r in rows if str(r.get(col)) == val]
            return self._json(200, {"data": rows, "meta": {"total": len(rows)}})
        if rest[0] == "records" and len(rest) == 3:
            self.state.record_gets.append((rest[1], rest[2]))
            row = self.state.tables.get(rest[1], {}).get(rest[2])
            if row is None:
                return self._error(404, "NOT_FOUND", "Record not found")
            return self._json(200, {"data": row})
        if rest[0] == "approvals" and len(rest) == 2:
            a = self.state.approvals.get(rest[1])
            if a is None:
                return self._error(404, "NOT_FOUND", "Approval not found")
            return self._json(200, {"data": a})
        self._error(404, "NOT_FOUND", "no route")

    def do_POST(self) -> None:  # noqa: N802
        segs, _query = self._route()
        if segs[:2] != ["api", APP]:
            return self._error(404, "NOT_FOUND", "App not found")
        if not self._authed():
            return
        rest = segs[2:]
        body = self._body()
        if rest[0] == "fn" and len(rest) == 2:
            self.state.fn_calls.append((rest[1], body))
            script = self.state.functions.get(rest[1])
            if not script:
                return self._error(404, "NOT_FOUND", f"Function '{rest[1]}' not found")
            status, payload = script.pop(0) if len(script) > 1 else script[0]
            if status >= 400:
                return self._error(status, payload["code"], payload["message"], payload.get("headers"))
            return self._json(status, {"data": payload})
        if rest[0] == "records" and len(rest) == 2:
            table = self.state.tables.setdefault(rest[1], {})
            row = {"id": len(table) + 1, **body}
            table[str(row["id"])] = row
            self.state.add_event("record.created", row)
            return self._json(201, {"data": row})
        if rest == ["uploads", "init"]:
            return self._upload_init(body)
        if rest == ["uploads", "complete"]:
            return self._upload_complete(body)
        if rest[0] == "approvals" and len(rest) == 3 and rest[2] == "consume":
            a = self.state.approvals.get(rest[1])
            if a is None:
                return self._error(404, "NOT_FOUND", "Approval not found")
            ok = a["status"] == "approved" and body.get("payloadHash") == a["payloadHash"]
            if not ok:
                return self._error(409, "CONFLICT", "Approval is not approved, has expired, was already consumed, or the payload hash does not match")
            a["status"] = "consumed"
            self.state.consumed.append((rest[1], body["payloadHash"]))
            return self._json(200, {"data": {"consumed": True}})
        self._error(404, "NOT_FOUND", "no route")

    def do_PUT(self) -> None:  # noqa: N802
        parts = urlsplit(self.path)
        m = re.fullmatch(r"/storage/(up_\w+)/(\d+)", parts.path)
        if not m:
            return self._error(404, "NOT_FOUND", "no route")
        if "Content-Length" not in self.headers or self.headers.get("Transfer-Encoding"):
            return self._error(411, "LENGTH_REQUIRED", "presigned PUTs need Content-Length")
        length = int(self.headers["Content-Length"])
        data = self.rfile.read(length)
        self.state.storage_puts.append({
            "path": parts.path, "length": length,
            "api_key": self.headers.get("X-Api-Key"), "content_type": self.headers.get("Content-Type"),
        })
        if self.state.put_failures.get(parts.path, 0) > 0:
            self.state.put_failures[parts.path] -= 1
            return self._error(500, "INTERNAL", "storage hiccup")
        upload = self.state.uploads[m.group(1)]
        upload["parts"][int(m.group(2))] = data
        self.send_response(200)
        self.send_header("ETag", f'"etag-{m.group(2)}-{len(data)}"')
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ── uploads ──
    def _upload_init(self, body: dict[str, Any]) -> None:
        guid = f"up_{len(self.state.uploads) + 1:04d}"
        size = body["size"]
        upload = {"body": body, "parts": {}, "size": size}
        self.state.uploads[guid] = upload
        base = f"http://127.0.0.1:{self.server.server_port}/storage/{guid}"
        if size >= self.state.multipart_threshold:
            count = -(-size // self.state.part_size)
            upload["multipart"] = True
            return self._json(200, {"data": {
                "upload_guid": guid, "method": "multipart", "upload_id": "mp-1",
                "part_size": self.state.part_size,
                "parts": [{"partNumber": i, "url": f"{base}/{i}?X-Amz-Signature=x"} for i in range(1, count + 1)],
                "expires_in": 3600,
            }})
        upload["multipart"] = False
        self._json(200, {"data": {
            "upload_guid": guid, "method": "PUT", "url": f"{base}/1?X-Amz-Signature=x",
            "headers": {"Content-Type": body["content_type"]}, "expires_in": 3600,
        }})

    def _upload_complete(self, body: dict[str, Any]) -> None:
        upload = self.state.uploads.get(body["upload_guid"])
        if upload is None:
            return self._error(404, "NOT_FOUND", "Upload not found")
        if upload["multipart"]:
            parts = body.get("parts") or []
            numbers = [p["part_number"] for p in parts]
            if numbers != sorted(upload["parts"]):
                return self._error(400, "VALIDATION_ERROR", "Parts required for multipart upload")
            for p in parts:
                data = upload["parts"][p["part_number"]]
                if p["etag"] != f'"etag-{p["part_number"]}-{len(data)}"':
                    return self._error(400, "VALIDATION_ERROR", "bad etag")
        assembled = b"".join(upload["parts"][k] for k in sorted(upload["parts"]))
        if len(assembled) != upload["size"]:
            return self._error(409, "CONFLICT", f"Uploaded bytes ({len(assembled)}) do not match the declared size ({upload['size']})")
        upload["bytes"] = assembled
        self.state.completed.append(body)
        b = upload["body"]
        self._json(201, {"data": {
            "guid": body["upload_guid"], "name": b["filename"], "size": len(assembled),
            "content_type": b["content_type"], "url": f"https://media.example/{body['upload_guid']}",
            "is_public": b.get("public", False), "table": b.get("table"), "record_id": b.get("record_id"),
            "variants": [],
        }})

    # ── stream ──
    def _stream(self, table: str, query: dict[str, list[str]]) -> None:
        st = self.state
        last = self.headers.get("Last-Event-ID") or query.get("last_event_id", [None])[0]
        index = len(st.connections)
        st.connections.append(StreamConnection(last, query))
        if st.stream_status:
            return self._error(st.stream_status, "FORBIDDEN" if st.stream_status == 403 else "RATE_LIMIT", "stream refused")
        plan = st.stream_plan[index] if index < len(st.stream_plan) else "live"

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

        def write(text: str) -> bool:
            try:
                self.wfile.write(text.encode())
                self.wfile.flush()
                return True
            except OSError:
                return False

        write("retry: 50\n\n")
        with st.cond:
            known = [e[0] for e in st.events]
            if last is None:
                cursor = len(st.events)  # a fresh subscriber starts at the tip
            elif last in known:
                cursor = known.index(last) + 1
            else:
                cursor = len(st.events)
                tip = st.events[-1][0] if st.events else "0-0"
                write(f"id: {tip}\nevent: reset\ndata: {json.dumps({'reason': 'unknown event id'})}\n\n")

        def flush_new() -> bool:
            nonlocal cursor
            with st.cond:
                pending = st.events[cursor:]
                cursor = len(st.events)
            for event_id, event, data in pending:
                if not write(f"id: {event_id}\nevent: {event}\ndata: {json.dumps(data)}\n\n"):
                    return False
            return True

        if not flush_new():
            return
        if plan == "close":
            return
        if plan == "silent":
            while not st.stopping:
                time.sleep(0.05)
            return
        while not st.stopping:
            with st.cond:
                st.cond.wait(st.keepalive_s)
            if not flush_new() or not write(": keepalive\n\n"):
                return


class MockServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _Handler)
        self.state = MockState()
        self.thread = threading.Thread(target=self.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server_port}"

    def start(self) -> "MockServer":
        self.thread.start()
        return self

    def stop(self) -> None:
        with self.state.cond:
            self.state.stopping = True
            self.state.cond.notify_all()
        self.shutdown()
        self.server_close()
