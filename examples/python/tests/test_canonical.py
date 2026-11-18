"""Canonical JSON must be byte-identical to the server's (JavaScript) output."""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

import pytest

from gipity_device import approval_challenge, canonical_json, key_fingerprint, payload_hash, summary_hash

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
    assert approval_challenge(a["id"], a["payloadHash"], summary_hash(a["summary"], a["details"]), a["expiresAt"]) == a["proof"]["challenge"]


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


def test_key_fingerprint_matches_the_rfc7638_thumbprint() -> None:
    # RFC 7638 section 3.1 example key: thumbprint NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs.
    n = ("0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw")
    thumb = base64.urlsafe_b64decode("NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs=").hex()[:16]
    assert key_fingerprint({"kty": "RSA", "n": n, "e": "AQAB", "alg": "RS256"}) == " ".join(thumb[i:i + 4] for i in range(0, 16, 4))
    # The same value the server and the CLI print for the fixture's passkey.
    assert key_fingerprint(FIXTURE["approval"]["proof"]["publicKeyJwk"]) == "feed 9234 487a e4fe"
