"""verify_approval against a real proof the platform produced (the same fixture
the CLI's TypeScript verifier is tested with), plus negative cases."""
from __future__ import annotations

import base64
import copy
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from gipity_device import Client, approval_challenge, payload_hash, verify_approval
from mock_server import MockServer

FX = json.loads((Path(__file__).parent / "fixtures" / "approval_proof.json").read_text())
APPROVAL: dict[str, Any] = FX["approval"]
PAYLOAD = FX["payload"]
PINNED = FX["pinnedJwk"]
ORIGIN = "https://a.gipity.ai"
EXPIRES = datetime.fromisoformat(APPROVAL["expiresAt"].replace("Z", "+00:00"))
BEFORE = EXPIRES - timedelta(minutes=1)


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def with_proof(**changes: str) -> dict[str, Any]:
    a = copy.deepcopy(APPROVAL)
    a["proof"].update(changes)
    return a


def test_every_crypto_check_passes_and_only_expiry_fails_now() -> None:
    r = verify_approval(APPROVAL, PAYLOAD, PINNED, ORIGIN)
    assert r.failed == ["not expired"]
    assert r.ok is False and r.pinned is True
    assert len(r.checks) == 10


def test_verifies_fully_before_expiry_and_accepts_the_response_envelope() -> None:
    r = verify_approval({"data": APPROVAL}, PAYLOAD, PINNED, ORIGIN, now=BEFORE)
    assert r.failed == [] and r.ok is True


def test_tampered_payload_fails_hash_and_challenge() -> None:
    r = verify_approval(APPROVAL, {**PAYLOAD, "target": 90}, PINNED, ORIGIN, now=BEFORE)
    assert r.failed == ["payload hash matches", "clientData challenge matches"]


def test_wrong_pinned_key_fails() -> None:
    nums = ec.generate_private_key(ec.SECP256R1()).public_key().public_numbers()
    other = {"kty": "EC", "crv": "P-256", "x": b64u(nums.x.to_bytes(32, "big")), "y": b64u(nums.y.to_bytes(32, "big"))}
    r = verify_approval(APPROVAL, PAYLOAD, other, ORIGIN, now=BEFORE)
    assert r.failed == ["proof key is the pinned key", "signature verifies"]


def test_wrong_origin_fails() -> None:
    r = verify_approval(APPROVAL, PAYLOAD, PINNED, "https://app.gipity.ai", now=BEFORE)
    assert r.failed == ["clientData origin matches", "rpIdHash matches"]


def test_missing_user_verification_fails() -> None:
    ad = bytearray(unb64u(APPROVAL["proof"]["authenticatorData"]))
    ad[32] &= ~0x04
    r = verify_approval(with_proof(authenticatorData=b64u(bytes(ad))), PAYLOAD, PINNED, ORIGIN, now=BEFORE)
    assert r.failed == ["user verified (UV)", "signature verifies"]


def test_forged_signature_fails() -> None:
    sig = unb64u(APPROVAL["proof"]["signature"])[::-1]
    r = verify_approval(with_proof(signature=b64u(sig)), PAYLOAD, PINNED, ORIGIN, now=BEFORE)
    assert r.failed == ["signature verifies"]


def test_garbage_client_data_fails_without_raising() -> None:
    r = verify_approval(with_proof(clientDataJSON=b64u(b"not json")), PAYLOAD, PINNED, ORIGIN, now=BEFORE)
    assert "clientDataJSON parses" in r.failed and r.ok is False


def test_no_proof_never_verifies() -> None:
    r = verify_approval({**APPROVAL, "status": "pending", "proof": None}, PAYLOAD, PINNED, ORIGIN)
    assert r.failed == ["proof present"] and r.ok is False


def test_unpinned_uses_the_proof_key_and_says_so() -> None:
    r = verify_approval(APPROVAL, PAYLOAD, None, ORIGIN, now=BEFORE)
    assert r.ok is True and r.pinned is False


def test_naive_now_is_refused() -> None:
    with pytest.raises(ValueError):
        verify_approval(APPROVAL, PAYLOAD, PINNED, ORIGIN, now=datetime(2026, 1, 1))


def _synthetic(sign: Any, jwk: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    payload = {"a": 1}
    expires = (datetime.now(timezone.utc) + timedelta(minutes=1)).replace(microsecond=0)
    expires_at = expires.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    h = payload_hash(payload)
    ad = hashlib.sha256(b"a.gipity.ai").digest() + bytes([0x05]) + (1).to_bytes(4, "big")
    cd = json.dumps({"type": "webauthn.get", "challenge": approval_challenge("ap_synth", h, expires_at), "origin": ORIGIN}).encode()
    sig = sign(ad + hashlib.sha256(cd).digest())
    approval = {
        "id": "ap_synth", "status": "approved", "payloadHash": h, "expiresAt": expires_at,
        "proof": {"credentialId": "x", "publicKeyJwk": jwk, "authenticatorData": b64u(ad),
                  "clientDataJSON": b64u(cd), "signature": b64u(sig), "rpId": "a.gipity.ai", "origin": ORIGIN, "challenge": ""},
    }
    return approval, payload


def test_ed25519_passkey_verifies() -> None:
    key = Ed25519PrivateKey.generate()
    from cryptography.hazmat.primitives import serialization
    raw = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    jwk = {"kty": "OKP", "crv": "Ed25519", "x": b64u(raw)}
    approval, payload = _synthetic(key.sign, jwk)
    assert verify_approval(approval, payload, jwk).failed == []


def test_rs256_passkey_verifies() -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    n = key.public_key().public_numbers()
    jwk = {"kty": "RSA", "n": b64u(n.n.to_bytes(256, "big")), "e": b64u(n.e.to_bytes(3, "big"))}
    approval, payload = _synthetic(lambda d: key.sign(d, padding.PKCS1v15(), hashes.SHA256()), jwk)
    assert verify_approval(approval, payload, jwk).failed == []


def test_get_and_consume_against_the_api(server: MockServer, client: Client) -> None:
    server.state.approvals[APPROVAL["id"]] = copy.deepcopy(APPROVAL)
    fetched = client.get_approval(APPROVAL["id"])
    assert verify_approval(fetched, PAYLOAD, PINNED, ORIGIN, now=BEFORE).ok
    assert client.consume_approval(APPROVAL["id"], "0" * 64) is False  # wrong hash: 409
    assert client.consume_approval(APPROVAL["id"], payload_hash(PAYLOAD)) is True
    assert client.consume_approval(APPROVAL["id"], payload_hash(PAYLOAD)) is False  # single use
    assert server.state.consumed == [(APPROVAL["id"], APPROVAL["payloadHash"])]
