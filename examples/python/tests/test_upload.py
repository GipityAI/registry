"""Presigned uploads: single PUT, multipart, part retry, and no API key at storage."""
from __future__ import annotations

import io
import os
from pathlib import Path

import pytest

from gipity_device import Client, GipityError
from mock_server import MockServer


def test_single_put_upload_from_a_path(server: MockServer, client: Client, tmp_path: Path) -> None:
    f = tmp_path / "photo.jpg"
    data = os.urandom(3000)
    f.write_bytes(data)
    out = client.upload(f, table="readings", record_id="42")
    assert out["name"] == "photo.jpg" and out["size"] == 3000 and out["content_type"] == "image/jpeg"
    up = server.state.uploads[out["guid"]]
    assert up["bytes"] == data and up["body"]["table"] == "readings" and up["body"]["record_id"] == "42"
    put = server.state.storage_puts[0]
    assert put["api_key"] is None and put["content_type"] == "image/jpeg" and put["length"] == 3000


def test_multipart_upload_streams_each_part_and_retries_a_failed_one(server: MockServer, client: Client, tmp_path: Path) -> None:
    st = server.state
    data = os.urandom(10_500)  # 3 parts of 4000, 4000, 2500
    f = tmp_path / "video.bin"
    f.write_bytes(data)
    st.put_failures["/storage/up_0001/2"] = 1
    out = client.upload(f, content_type="application/octet-stream")
    assert st.uploads[out["guid"]]["bytes"] == data
    assert [p["length"] for p in st.storage_puts] == [4000, 4000, 4000, 2500]  # part 2 sent twice
    assert all(p["api_key"] is None for p in st.storage_puts)
    assert [p["part_number"] for p in st.completed[0]["parts"]] == [1, 2, 3]


def test_upload_from_a_file_object_at_an_offset(server: MockServer, client: Client) -> None:
    buf = io.BytesIO(b"HEADER" + b"payload-bytes")
    buf.seek(6)
    out = client.upload(buf, filename="p.txt")
    assert server.state.uploads[out["guid"]]["bytes"] == b"payload-bytes"


def test_non_seekable_stream_needs_size_and_is_not_retried(server: MockServer, client: Client) -> None:
    class Pipe(io.RawIOBase):
        def __init__(self, data: bytes) -> None:
            self._b = io.BytesIO(data)

        def readable(self) -> bool:
            return True

        def seekable(self) -> bool:
            return False

        def read(self, n: int = -1) -> bytes:
            return self._b.read(n)

    with pytest.raises(ValueError):
        client.upload(Pipe(b"abc"), filename="a.bin")
    out = client.upload(Pipe(b"abcdef"), filename="a.bin", size=6)
    assert server.state.uploads[out["guid"]]["bytes"] == b"abcdef"
    server.state.put_failures["/storage/up_0002/1"] = 1
    with pytest.raises(GipityError):
        client.upload(Pipe(b"xyz"), filename="b.bin", size=3)


def test_empty_file_is_refused(client: Client, tmp_path: Path) -> None:
    f = tmp_path / "empty"
    f.write_bytes(b"")
    with pytest.raises(ValueError):
        client.upload(f)
