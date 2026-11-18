"""A Records change stream that never misses an event.

``GET /api/<app>/records/<table>/stream`` is Server-Sent Events: every change
has an ``id:``, a ``: keepalive`` comment arrives every 15 seconds, and a
reconnect that sends the last id back (``Last-Event-ID``) replays everything
missed in the last 24 hours, in order. :class:`Subscription` drives that for a
device: it detects a dead connection (no bytes for ``heartbeat_timeout``),
reconnects with backoff, resumes from the last event the handler finished,
persists that cursor so a restart resumes too, calls ``on_reset`` when the
server says events may be gone, and fetches rows too large to be inlined.

Delivery is at least once: the cursor moves only after ``on_event`` returns, so
an event the handler didn't finish (it raised, or the process died) is
delivered again. Make handlers idempotent (e.g. skip a command id already done).
"""
from __future__ import annotations

import json
import os
import random
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Optional, Protocol, Union
from urllib.parse import quote

import httpx

from .errors import GipityError

if TYPE_CHECKING:
    from .client import Client

__all__ = ["RecordEvent", "Subscription", "CursorStore", "FileCursor"]

#: Statuses that won't get better by reconnecting: bad key, no access, no table.
_FATAL_STATUSES = {400, 401, 403, 404}


@dataclass(frozen=True)
class RecordEvent:
    """One change on a Records table.

    Attributes:
        id: The event's stream id (what the cursor stores).
        type: ``record.created``, ``record.updated`` or ``record.deleted``.
        table: The table it happened on.
        record_id: The row's primary key.
        record: The row after the change (``None`` for a delete, or when an
            omitted row was deleted before it could be fetched).
        changes: For an update, ``{field: [old, new]}`` (``None`` when omitted).
        omitted: The row was over the stream's inline size limit and was
            fetched with ``GET /records/<table>/<id>`` instead.
        data: The event's raw JSON payload.
    """

    id: Optional[str]
    type: str
    table: str
    record_id: Any
    record: Optional[dict[str, Any]]
    changes: Optional[dict[str, Any]]
    omitted: bool
    data: Any


class CursorStore(Protocol):
    """Where a subscription keeps the id of the last event it finished."""

    def load(self) -> Optional[str]: ...

    def save(self, event_id: str) -> None: ...


class FileCursor:
    """A cursor in a small text file, replaced atomically on every save."""

    def __init__(self, path: Union[str, "os.PathLike[str]"]) -> None:
        self.path = Path(path)

    def load(self) -> Optional[str]:
        try:
            text = self.path.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            return None
        return text or None

    def save(self, event_id: str) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=f".{self.path.name}.")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(event_id)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise


class _HandlerFailed(Exception):
    pass


class Subscription:
    """Follow ``table``'s change stream. Create it with :meth:`Client.subscribe`.

    Args:
        on_event: Called with each :class:`RecordEvent`, in stream order. The
            cursor moves only after it returns; if it raises, the connection
            is dropped and the event is delivered again after a backoff.
        last_event_id: Resume after this id (overrides the stored cursor).
        cursor_file: Keep the cursor in this file, so a restarted process
            resumes where it stopped.
        save_cursor: Called with each finished event id, to keep the cursor
            somewhere else (a database row, ...). Combine with ``last_event_id``
            on startup to resume.
        on_reset: Called with the server's reason when events after the cursor
            may be gone (older than 24 hours, or an unknown id). Re-read the
            state you care about with the Records API, then return; the stream
            continues from the reset's id. Required: without it a reset raises
            :class:`GipityError` rather than silently skipping events.
        on_error: Called with each connection or handler error before the
            reconnect (logging hook). Fatal errors are raised from ``run()``.
        filter, any, fields: Records query params narrowing the stream.
        heartbeat_timeout: Seconds without a byte before the connection is
            treated as dead (two missed 15-second keepalives, by default).
        initial_backoff, max_backoff: Reconnect delay bounds in seconds.
    """

    def __init__(
        self,
        client: "Client",
        table: str,
        on_event: Callable[[RecordEvent], None],
        *,
        last_event_id: Optional[str] = None,
        cursor_file: Optional[Union[str, "os.PathLike[str]"]] = None,
        save_cursor: Optional[Callable[[str], None]] = None,
        on_reset: Optional[Callable[[str], None]] = None,
        on_error: Optional[Callable[[BaseException], None]] = None,
        filter: Optional[str] = None,
        any: Optional[str] = None,
        fields: Optional[str] = None,
        heartbeat_timeout: float = 35.0,
        initial_backoff: float = 1.0,
        max_backoff: float = 30.0,
    ) -> None:
        self.client = client
        self.table = table
        self.on_event = on_event
        self.on_reset = on_reset
        self.on_error = on_error
        self.heartbeat_timeout = heartbeat_timeout
        self.initial_backoff = initial_backoff
        self.max_backoff = max_backoff
        self._file = FileCursor(cursor_file) if cursor_file is not None else None
        self._save_cursor = save_cursor
        self._params = {k: v for k, v in {"filter": filter, "any": any, "fields": fields}.items() if v is not None}
        self._last_id = last_event_id if last_event_id is not None else (self._file.load() if self._file else None)
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._response: Optional[httpx.Response] = None
        self._server_retry: Optional[float] = None
        self._lock = threading.Lock()
        self._accepted = False
        #: Number of connections opened so far (handy for health reporting).
        self.connections = 0

    @property
    def last_event_id(self) -> Optional[str]:
        """The id of the last event the handler finished (the resume point)."""
        return self._last_id

    # ── lifecycle ─────────────────────────────────────────────────────────

    def start(self) -> "Subscription":
        """Run in a daemon thread. Errors that end the stream go to ``on_error``."""
        if self._thread is not None:
            raise RuntimeError("subscription already started")

        def target() -> None:
            try:
                self.run()
            except BaseException as exc:  # noqa: BLE001 - reported, thread ends
                if self.on_error:
                    self.on_error(exc)

        self._thread = threading.Thread(target=target, name=f"gipity-stream-{self.table}", daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        """Stop following the stream (from any thread)."""
        self._stop.set()
        with self._lock:
            response = self._response
        if response is not None:
            try:
                response.close()
            except Exception:  # noqa: BLE001 - the reader notices the stop either way
                pass

    def join(self, timeout: Optional[float] = None) -> None:
        """Wait for a started subscription's thread to end."""
        if self._thread is not None:
            self._thread.join(timeout)

    def run(self) -> None:
        """Follow the stream until :meth:`stop`. Raises on a fatal error
        (bad key, no access, unknown table, or a reset with no ``on_reset``)."""
        attempt = 0
        timeout = httpx.Timeout(10.0, read=self.heartbeat_timeout)
        with httpx.Client(base_url=self.client.api_base, headers=self.client.auth_headers(), timeout=timeout) as http:
            while not self._stop.is_set():
                self._accepted = False
                failed: Optional[BaseException] = None
                try:
                    self._connect(http)
                except GipityError as err:
                    if err.status in _FATAL_STATUSES or err.code == "RESET_UNHANDLED":
                        raise
                    failed = err
                except _HandlerFailed as wrapped:
                    failed = wrapped.__cause__ or wrapped
                except Exception as exc:  # noqa: BLE001 - network errors, or the stream closed by stop()
                    if self._stop.is_set():
                        break
                    failed = exc
                if self._stop.is_set():
                    break
                if failed is not None:
                    self._report(failed)
                # A connection the server accepted resets the backoff.
                attempt = (1 if failed else 0) if self._accepted else attempt + 1
                self._stop.wait(self._delay(attempt))

    # ── internals ─────────────────────────────────────────────────────────

    def _report(self, exc: BaseException) -> None:
        if self.on_error:
            self.on_error(exc)

    def _delay(self, attempt: int) -> float:
        floor = max(self.initial_backoff, self._server_retry or 0.0)
        if attempt <= 0:
            return floor
        return float(min(self.max_backoff, floor * (2 ** (attempt - 1))) * random.uniform(0.5, 1.0))

    def _connect(self, http: httpx.Client) -> None:
        """One connection, read until it ends."""
        headers = {"Accept": "text/event-stream", "Cache-Control": "no-cache"}
        if self._last_id:
            headers["Last-Event-ID"] = self._last_id
        with http.stream("GET", f"/records/{quote(self.table, safe='')}/stream", headers=headers, params=self._params) as response:
            if response.status_code != 200:
                response.read()
                raise self.client._error_from(response)
            self.connections += 1
            self._accepted = True
            with self._lock:
                self._response = response
            try:
                self._read(response)
            finally:
                with self._lock:
                    self._response = None

    def _read(self, response: httpx.Response) -> None:
        event_name = ""
        data_lines: list[str] = []
        event_id: Optional[str] = None
        for line in response.iter_lines():
            if self._stop.is_set():
                return
            if line == "":
                if data_lines:
                    self._dispatch(event_name or "message", "\n".join(data_lines), event_id)
                event_name, data_lines, event_id = "", [], None
                continue
            if line.startswith(":"):
                continue  # keepalive comment
            name, sep, value = line.partition(":")
            if sep and value.startswith(" "):
                value = value[1:]
            if name == "data":
                data_lines.append(value)
            elif name == "event":
                event_name = value
            elif name == "id":
                if "\0" not in value:
                    event_id = value
            elif name == "retry" and value.isdigit():
                self._server_retry = int(value) / 1000.0
        # The server closed the stream; the caller reconnects from the cursor.

    def _commit(self, event_id: Optional[str]) -> None:
        if not event_id:
            return
        if self._file:
            self._file.save(event_id)
        if self._save_cursor:
            self._save_cursor(event_id)
        self._last_id = event_id

    def _dispatch(self, name: str, raw: str, event_id: Optional[str]) -> None:
        try:
            data = json.loads(raw)
        except ValueError as exc:
            raise _HandlerFailed("the stream sent an event that is not JSON") from exc

        if name == "reset":
            reason = data.get("reason", "") if isinstance(data, dict) else ""
            if self.on_reset is None:
                raise GipityError(0, "RESET_UNHANDLED",
                                  f"the {self.table} stream was reset ({reason}); events may have been missed. "
                                  "Pass on_reset to re-sync from the Records API.")
            try:
                self.on_reset(str(reason))
            except Exception as exc:
                raise _HandlerFailed("on_reset failed") from exc
            self._commit(event_id)
            return

        try:
            event = self._event(name, data, event_id)
            self.on_event(event)
        except Exception as exc:
            raise _HandlerFailed(f"handling event {event_id} failed") from exc
        self._commit(event_id)

    def _event(self, name: str, data: Any, event_id: Optional[str]) -> RecordEvent:
        obj = data if isinstance(data, dict) else {}
        omitted = obj.get("record_omitted") is True
        record: Optional[dict[str, Any]]
        changes: Optional[dict[str, Any]] = None
        if name == "record.created":
            record = None if omitted else obj
        elif name == "record.updated":
            record = obj.get("record")
            changes = obj.get("changes")
        else:
            record = None
        record_id = obj.get("id") if obj.get("id") is not None else (record or {}).get("id")
        if omitted and name != "record.deleted" and record_id is not None:
            record = self._fetch(record_id)
        return RecordEvent(
            id=event_id, type=name, table=self.table, record_id=record_id,
            record=record, changes=changes, omitted=omitted, data=data,
        )

    def _fetch(self, record_id: Any) -> Optional[dict[str, Any]]:
        try:
            return self.client.records.get(self.table, record_id)
        except GipityError as err:
            if err.status == 404:
                return None  # deleted since; its record.deleted event follows
            raise
