"""The Records change stream: replay, resume, heartbeat loss, reset, omitted rows."""
from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any, Callable

import pytest

from gipity_device import Client, GipityError, RecordEvent
from mock_server import MockServer


def wait_for(cond: Callable[[], bool], timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if cond():
            return
        time.sleep(0.01)
    raise AssertionError("timed out waiting")


def fast(**kw: Any) -> dict[str, Any]:
    return {"initial_backoff": 0.02, "max_backoff": 0.1, "heartbeat_timeout": 2.0, **kw}


def test_resumes_after_a_drop_and_after_a_restart(server: MockServer, client: Client, tmp_path: Path) -> None:
    st = server.state
    for i in (1, 2):
        st.add_event("record.created", {"id": i, "cmd": f"c{i}"})
    cursor = tmp_path / "cursor"
    cursor.write_text("1-0")  # a previous run finished event 1
    st.stream_plan = ["close", "live"]
    got: list[RecordEvent] = []
    sub = client.subscribe("commands", got.append, cursor_file=cursor, **fast()).start()
    wait_for(lambda: len(st.connections) >= 2)
    st.add_event("record.created", {"id": 3, "cmd": "c3"})
    wait_for(lambda: len(got) == 2)
    sub.stop()
    sub.join(2)
    assert [e.record_id for e in got] == [2, 3]
    assert [c.last_event_id for c in st.connections[:2]] == ["1-0", "2-0"]
    assert cursor.read_text() == "3-0" and sub.last_event_id == "3-0"

    # A new process with the same cursor file resumes after event 3.
    got2: list[RecordEvent] = []
    sub2 = client.subscribe("commands", got2.append, cursor_file=cursor, **fast()).start()
    wait_for(lambda: len(st.connections) >= 3)
    sub2.stop()
    sub2.join(2)
    assert st.connections[-1].last_event_id == "3-0" and got2 == []


def test_a_silent_connection_is_detected_and_replaced(server: MockServer, client: Client) -> None:
    st = server.state
    st.add_event("record.created", {"id": 1})
    st.stream_plan = ["silent", "live"]
    got: list[RecordEvent] = []
    errors: list[BaseException] = []
    sub = client.subscribe("commands", got.append, last_event_id="1-0", on_error=errors.append,
                           **fast(heartbeat_timeout=0.3)).start()
    wait_for(lambda: len(st.connections) >= 2)
    st.add_event("record.updated", {"id": 1, "changes": {"status": ["pending", "done"]}, "record": {"id": 1, "status": "done"}})
    wait_for(lambda: len(got) == 1)
    sub.stop()
    sub.join(2)
    assert got[0].type == "record.updated" and got[0].changes == {"status": ["pending", "done"]}
    assert st.connections[1].last_event_id == "1-0"
    assert any("timed out" in str(e).lower() or "timeout" in type(e).__name__.lower() for e in errors)


def test_reset_calls_on_reset_and_continues_from_the_reset_id(server: MockServer, client: Client) -> None:
    st = server.state
    st.add_event("record.created", {"id": 1})
    st.add_event("record.created", {"id": 2})
    resets: list[str] = []
    got: list[RecordEvent] = []
    saved: list[str] = []
    sub = client.subscribe("commands", got.append, last_event_id="999-0", on_reset=resets.append,
                           save_cursor=saved.append, **fast()).start()
    wait_for(lambda: resets != [])
    st.add_event("record.created", {"id": 3})
    wait_for(lambda: len(got) == 1)
    sub.stop()
    sub.join(2)
    assert resets == ["unknown event id"]
    assert saved == ["2-0", "3-0"] and got[0].record_id == 3


def test_a_reset_without_on_reset_raises_instead_of_skipping(server: MockServer, client: Client) -> None:
    server.state.add_event("record.created", {"id": 1})
    sub = client.subscribe("commands", lambda e: None, last_event_id="999-0", **fast())
    with pytest.raises(GipityError) as exc:
        sub.run()
    assert exc.value.code == "RESET_UNHANDLED" and sub.last_event_id == "999-0"


def test_omitted_rows_are_fetched_by_id(server: MockServer, client: Client) -> None:
    st = server.state
    big = {"id": 7, "blob": "x" * 70000}
    st.tables["commands"] = {"7": big}
    got: list[RecordEvent] = []
    sub = client.subscribe("commands", got.append, **fast()).start()
    wait_for(lambda: len(st.connections) >= 1)
    time.sleep(0.05)
    st.add_event("record.created", {"id": 7, "record": None, "record_omitted": True})
    st.add_event("record.updated", {"id": 8, "changes": None, "record": None, "record_omitted": True})  # gone since
    st.add_event("record.deleted", {"id": 7})
    wait_for(lambda: len(got) == 3)
    sub.stop()
    sub.join(2)
    assert got[0].omitted and got[0].record == big
    assert got[1].omitted and got[1].record is None and got[1].record_id == 8
    assert got[2].type == "record.deleted" and got[2].record_id == 7 and not got[2].omitted
    assert st.record_gets == [("commands", "7"), ("commands", "8")]


def test_a_failed_handler_gets_the_event_again(server: MockServer, client: Client) -> None:
    st = server.state
    seen: list[Any] = []
    lock = threading.Lock()

    def handler(e: RecordEvent) -> None:
        with lock:
            seen.append(e.record_id)
            if len(seen) == 1:
                raise RuntimeError("relay stuck")

    st.add_event("record.created", {"id": 1})
    st.add_event("record.created", {"id": 2})
    sub = client.subscribe("commands", handler, last_event_id="1-0", **fast()).start()
    wait_for(lambda: len(seen) >= 2)
    sub.stop()
    sub.join(2)
    assert seen[:2] == [2, 2] and sub.last_event_id == "2-0"
    assert st.connections[1].last_event_id == "1-0"


def test_rejected_stream_is_fatal_but_rate_limit_is_retried(server: MockServer, client: Client) -> None:
    server.state.stream_status = 403
    with pytest.raises(GipityError) as exc:
        client.subscribe("commands", lambda e: None, **fast()).run()
    assert exc.value.status == 403

    server.state.stream_status = 429
    sub = client.subscribe("commands", lambda e: None, **fast()).start()
    wait_for(lambda: len(server.state.connections) >= 4)
    server.state.stream_status = None
    wait_for(lambda: sub.connections == 1)
    sub.stop()
    sub.join(2)


def test_filter_and_fields_are_sent(server: MockServer, client: Client) -> None:
    sub = client.subscribe("commands", lambda e: None, filter="device:eq:boiler", fields="id,cmd",
                           **fast(heartbeat_timeout=30.0)).start()
    wait_for(lambda: len(server.state.connections) >= 1)
    time.sleep(0.1)
    started = time.monotonic()
    sub.stop()
    sub.join(5)
    assert sub._thread is not None and not sub._thread.is_alive()
    assert time.monotonic() - started < 1.0  # stop() interrupts the open connection
    assert server.state.connections[0].params == {"filter": ["device:eq:boiler"], "fields": ["id,cmd"]}
