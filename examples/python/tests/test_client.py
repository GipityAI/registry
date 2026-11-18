"""Functions, Records and the retry policy."""
from __future__ import annotations

import pytest

from gipity_device import Client, GipityError
from mock_server import APP, MockServer


def test_fn_call_returns_the_unwrapped_value(server: MockServer, client: Client) -> None:
    server.state.functions["add"] = [(200, {"sum": 3})]
    assert client.fn.call("add", {"a": 1, "b": 2}) == {"sum": 3}
    assert server.state.fn_calls == [("add", {"a": 1, "b": 2})]


def test_fn_call_retries_a_rate_limit_and_honors_retry_after(server: MockServer, client: Client, sleeps: list[float]) -> None:
    server.state.functions["ping"] = [
        (429, {"code": "RATE_LIMITED", "message": "Too many requests", "headers": {"Retry-After": "2"}}),
        (200, "pong"),
    ]
    assert client.fn.call("ping") == "pong"
    assert sleeps == [2.0]
    assert len(server.state.fn_calls) == 2


def test_fn_errors_are_not_retried_and_carry_the_api_error(server: MockServer, client: Client) -> None:
    server.state.functions["boom"] = [(500, {"code": "FUNCTION_ERROR", "message": "kaboom"})]
    with pytest.raises(GipityError) as exc:
        client.fn.call("boom")
    assert (exc.value.status, exc.value.code, exc.value.message) == (500, "FUNCTION_ERROR", "kaboom")
    assert len(server.state.fn_calls) == 1


def test_a_post_that_got_503_is_not_repeated(server: MockServer, client: Client) -> None:
    server.state.functions["send"] = [(503, {"code": "UNAVAILABLE", "message": "busy"}), (200, "ok")]
    with pytest.raises(GipityError):
        client.fn.call("send")
    assert len(server.state.fn_calls) == 1


def test_a_function_limit_exceeded_429_is_not_retried(server: MockServer, client: Client) -> None:
    server.state.functions["heavy"] = [(429, {"code": "LIMIT_EXCEEDED", "message": "row cap"}), (200, "ok")]
    with pytest.raises(GipityError) as exc:
        client.fn.call("heavy")
    assert exc.value.code == "LIMIT_EXCEEDED"


def test_records_create_get_list(server: MockServer, client: Client) -> None:
    row = client.records.create("commands", {"cmd": "open", "status": "pending"})
    assert row == {"id": 1, "cmd": "open", "status": "pending"}
    assert client.records.get("commands", 1) == row
    page = client.records.list("commands", filter="status:eq:pending")
    assert page.rows == [row] and page.total == 1
    assert client.records.list("commands", filter="status:eq:done").total == 0


def test_records_get_missing_raises_404(client: Client) -> None:
    with pytest.raises(GipityError) as exc:
        client.records.get("commands", 99)
    assert exc.value.status == 404


def test_get_retries_server_errors_with_backoff(server: MockServer, client: Client, sleeps: list[float]) -> None:
    server.state.list_failures = [503, 502, 429]
    assert client.records.list("commands").total == 0
    assert server.state.list_calls == 4
    assert len(sleeps) == 3 and sleeps[2] == 0.0  # Retry-After: 0 on the 429


def test_get_gives_up_after_max_retries(server: MockServer, client: Client) -> None:
    server.state.list_failures = [503] * 10
    with pytest.raises(GipityError) as exc:
        client.records.list("commands")
    assert exc.value.status == 503
    assert server.state.list_calls == client.max_retries + 1


def test_connection_refused_is_retried_then_reported(sleeps: list[float]) -> None:
    c = Client(APP, "k", base_url="http://127.0.0.1:9", max_retries=2, sleep=sleeps.append)
    with pytest.raises(GipityError) as exc:
        c.fn.call("x")
    assert exc.value.code == "NETWORK_ERROR" and len(sleeps) == 2


def test_a_bad_key_is_refused(server: MockServer) -> None:
    with Client(APP, "wrong", base_url=server.base_url) as c, pytest.raises(GipityError) as exc:
        c.records.list("commands")
    assert exc.value.status == 401
