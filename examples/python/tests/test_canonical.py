"""Canonical JSON must be byte-identical to the server's (JavaScript) output."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from gipity_device import approval_challenge, canonical_json, payload_hash

VECTORS = json.loads((Path(__file__).parent / "fixtures" / "js_vectors.json").read_text())
FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "approval_proof.json").read_text())


@pytest.mark.parametrize("vector", VECTORS["numbers"], ids=lambda v: v["repr"])
def test_numbers_format_like_json_stringify(vector: dict[str, str]) -> None:
    assert canonical_json(float(vector["repr"])) == vector["json"]


@pytest.mark.parametrize("vector", VECTORS["canonical"], ids=lambda v: v["canonical"][:30])
def test_values_canonicalize_like_the_server(vector: dict[str, str]) -> None:
    value = json.loads(vector["json"])
    out = canonical_json(value)
    assert out == vector["canonical"]
    assert hashlib.sha256(out.encode("utf-8")).hexdigest() == vector["sha256"]


def test_matches_the_server_fixture() -> None:
    a = FIXTURE["approval"]
    assert canonical_json({"unit": "C", "cmd": "set", "target": 65}) == '{"cmd":"set","target":65,"unit":"C"}'
    assert payload_hash(FIXTURE["payload"]) == a["payloadHash"]
    assert payload_hash({"target": 65.0, "unit": "C", "cmd": "set"}) == a["payloadHash"]
    assert approval_challenge(a["id"], a["payloadHash"], a["expiresAt"]) == a["proof"]["challenge"]


def test_integers_beyond_2_53_round_like_a_javascript_number() -> None:
    assert canonical_json(2**53) == "9007199254740992"
    assert canonical_json(2**53 + 1) == "9007199254740992"
    assert canonical_json(10**21) == "1e+21"
    assert canonical_json(True) == "true" and canonical_json(1) == "1"


def test_keys_sort_by_utf16_code_units() -> None:
    # U+1F600 is a surrogate pair (D83D ...), which sorts BEFORE U+FFFF in UTF-16.
    assert canonical_json({"￿": 1, "\U0001F600": 2}) == '{"\U0001F600":2,"￿":1}'


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), b"x", {1: "a"}, {"a": {1, 2}}, object()])
def test_unrepresentable_values_raise(bad: object) -> None:
    with pytest.raises(ValueError):
        canonical_json(bad)
