"""Offline verification of a Gipity passkey approval.

These are exactly the device-side checks of the platform's reference verifier
(``gipity approval verify``), with the same check names, so a device never has
to trust the server: the payload hash and the WebAuthn challenge are recomputed
locally from the command the device is about to run, and the passkey signature
is checked against a public key the device pinned when it was set up.

Rules (the ``app-approvals`` skill documents the same):

* ``payloadHash`` = hex sha256 of the canonical JSON of the payload;
* ``summaryHash`` = hex sha256 of the canonical JSON of ``{"details": details or null, "summary": summary}``;
* ``challenge`` = sha256("gipity-approval:v2|" + id + "|" + payloadHash + "|" + summaryHash + "|" + expiresAt);
* ``clientDataJSON``: ``type == "webauthn.get"``, ``challenge == base64url(challenge)``,
  ``origin == origin``;
* ``authenticatorData``: rpIdHash == sha256(hostname of origin), flags UP (0x01)
  and UV (0x04) set;
* the signature over ``authenticatorData || sha256(clientDataJSON)`` verifies
  with the pinned key, and the proof carries that same key;
* ``expiresAt`` is in the future.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Mapping, Optional
from urllib.parse import urlsplit

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .canonical import approval_challenge, payload_hash, summary_hash

__all__ = ["VerifyCheck", "VerifyResult", "verify_approval", "DEFAULT_ORIGIN"]

#: The relying-party origin of every passkey approval on Gipity.
DEFAULT_ORIGIN = "https://a.gipity.ai"

Jwk = Mapping[str, Any]


@dataclass(frozen=True)
class VerifyCheck:
    """One named check and whether it passed."""

    check: str
    ok: bool
    detail: Optional[str] = None


@dataclass(frozen=True)
class VerifyResult:
    """The outcome of :func:`verify_approval`. Act only when ``ok`` is true."""

    ok: bool
    pinned: bool
    checks: list[VerifyCheck] = field(default_factory=list)

    @property
    def failed(self) -> list[str]:
        """Names of the checks that failed (empty when ``ok``)."""
        return [c.check for c in self.checks if not c.ok]


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def _b64_int(value: str) -> int:
    return int.from_bytes(_b64url_decode(value), "big")


def _same_key(a: Jwk, b: Jwk) -> bool:
    kty = a.get("kty")
    if kty != b.get("kty"):
        return False
    if kty == "EC":
        return a.get("crv") == b.get("crv") and a.get("x") == b.get("x") and a.get("y") == b.get("y")
    if kty == "OKP":
        return a.get("crv") == b.get("crv") and a.get("x") == b.get("x")
    if kty == "RSA":
        return a.get("n") == b.get("n") and a.get("e") == b.get("e")
    return False


def _verify_signature(jwk: Jwk, data: bytes, signature: bytes) -> bool:
    """ES256 (DER ECDSA P-256 + SHA-256), EdDSA (Ed25519) or RS256 (PKCS#1 v1.5 + SHA-256)."""
    kty = jwk.get("kty")
    try:
        if kty == "EC":
            if jwk.get("crv") != "P-256":
                return False
            key = ec.EllipticCurvePublicNumbers(_b64_int(jwk["x"]), _b64_int(jwk["y"]), ec.SECP256R1()).public_key()
            key.verify(signature, data, ec.ECDSA(hashes.SHA256()))
            return True
        if kty == "OKP":
            if jwk.get("crv") != "Ed25519":
                return False
            Ed25519PublicKey.from_public_bytes(_b64url_decode(jwk["x"])).verify(signature, data)
            return True
        if kty == "RSA":
            key_rsa = rsa.RSAPublicNumbers(_b64_int(jwk["e"]), _b64_int(jwk["n"])).public_key()
            key_rsa.verify(signature, data, padding.PKCS1v15(), hashes.SHA256())
            return True
    except (InvalidSignature, ValueError, KeyError, TypeError, binascii.Error):
        return False
    return False


def _parse_expiry(expires_at: Any) -> Optional[datetime]:
    if not isinstance(expires_at, str):
        return None
    text = expires_at[:-1] + "+00:00" if expires_at.endswith("Z") else expires_at
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else None


def verify_approval(
    proof_response: Mapping[str, Any],
    payload: Any,
    pinned_public_key_jwk: Optional[Jwk],
    origin: str = DEFAULT_ORIGIN,
    *,
    now: Optional[datetime] = None,
) -> VerifyResult:
    """Verify a passkey approval offline, before running ``payload``.

    Args:
        proof_response: The approval as ``GET /api/<app>/approvals/<id>`` returns
            it: the body's ``data`` object (what :meth:`Client.get_approval`
            returns), or the whole ``{"data": {...}}`` body.
        payload: The exact command you are about to run. Its hash is
            recomputed here; never pass the payload hash from the server.
        pinned_public_key_jwk: The approver's public key (a JWK), pinned out of
            band when the device was set up. ``None`` uses the proof's own key,
            and the result says ``pinned=False``: only do that while pinning.
        origin: The relying-party origin, ``https://a.gipity.ai`` in production.
        now: The time to check expiry against (default: the current time).

    Returns:
        A :class:`VerifyResult`. ``ok`` is true only when every check passed.
        A verified approval is not yet permission to act: call
        :meth:`Client.consume_approval` and act only when it returns ``True``.
    """
    approval: Mapping[str, Any] = proof_response
    if "id" not in approval and isinstance(approval.get("data"), Mapping):
        approval = approval["data"]

    checks: list[VerifyCheck] = []
    pinned = pinned_public_key_jwk is not None

    def add(check: str, ok: bool, detail: Optional[str] = None) -> None:
        checks.append(VerifyCheck(check, ok, detail))

    proof = approval.get("proof")
    if not proof:
        add("proof present", False, f"approval is {approval.get('status')}; there is no passkey proof")
        return VerifyResult(False, pinned, checks)

    expected_rp_id = urlsplit(origin).hostname or ""
    local_hash = payload_hash(payload)
    hash_ok = local_hash == approval.get("payloadHash")
    add("payload hash matches", hash_ok, None if hash_ok else f"local {local_hash}")

    summary = approval.get("summary")
    details = approval.get("details")
    if not isinstance(summary, str) or not (details is None or isinstance(details, str)):
        add("summary present", False, "the approval has no summary/details to recompute the challenge from")
        summary, details = "", None
    sum_hash = summary_hash(summary, details)
    challenge = approval_challenge(str(approval.get("id")), local_hash, sum_hash, str(approval.get("expiresAt")))
    client_data: dict[str, Any] = {}
    try:
        client_data_bytes = _b64url_decode(str(proof.get("clientDataJSON", "")))
    except (binascii.Error, ValueError):
        client_data_bytes = b""
    try:
        parsed = json.loads(client_data_bytes.decode("utf-8"))
        if isinstance(parsed, dict):
            client_data = parsed
        else:
            add("clientDataJSON parses", False)
    except (UnicodeDecodeError, ValueError):
        add("clientDataJSON parses", False)
    add("clientData type is webauthn.get", client_data.get("type") == "webauthn.get")
    add("clientData challenge matches", client_data.get("challenge") == challenge)
    origin_ok = client_data.get("origin") == origin
    add("clientData origin matches", origin_ok, None if origin_ok else f"got {client_data.get('origin')}")

    try:
        auth_data = _b64url_decode(str(proof.get("authenticatorData", "")))
    except (binascii.Error, ValueError):
        auth_data = b""
    long_enough = len(auth_data) >= 37
    add("rpIdHash matches", long_enough and auth_data[:32] == _sha256(expected_rp_id.encode("utf-8")))
    flags = auth_data[32] if long_enough else 0
    add("user present (UP)", bool(flags & 0x01))
    add("user verified (UV)", bool(flags & 0x04))

    proof_key = proof.get("publicKeyJwk") or {}
    key = pinned_public_key_jwk if pinned_public_key_jwk is not None else proof_key
    if pinned_public_key_jwk is not None:
        add("proof key is the pinned key", _same_key(pinned_public_key_jwk, proof_key))
    try:
        signature = _b64url_decode(str(proof.get("signature", "")))
    except (binascii.Error, ValueError):
        signature = b""
    add("signature verifies", _verify_signature(key, auth_data + _sha256(client_data_bytes), signature))

    expires = _parse_expiry(approval.get("expiresAt"))
    if now is not None and now.tzinfo is None:
        raise ValueError("now must be timezone-aware, e.g. datetime.now(timezone.utc)")
    current = now or datetime.now(timezone.utc)
    not_expired = expires is not None and expires > current
    add("not expired", not_expired, None if not_expired else f"expired at {approval.get('expiresAt')}")

    return VerifyResult(all(c.ok for c in checks), pinned, checks)
