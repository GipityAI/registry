from __future__ import annotations

import sys
from pathlib import Path
from typing import Iterator

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from gipity_device import Client  # noqa: E402
from mock_server import APP, KEY, MockServer  # noqa: E402


@pytest.fixture
def server() -> Iterator[MockServer]:
    srv = MockServer().start()
    yield srv
    srv.stop()


@pytest.fixture
def sleeps() -> list[float]:
    return []


@pytest.fixture
def client(server: MockServer, sleeps: list[float]) -> Iterator[Client]:
    c = Client(APP, KEY, base_url=server.base_url, timeout=5.0, sleep=sleeps.append)
    yield c
    c.close()
