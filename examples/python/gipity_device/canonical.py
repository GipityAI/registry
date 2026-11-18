"""Canonical JSON (RFC 8785, JCS), byte for byte what the Gipity server hashes.

The server builds canonical JSON with JavaScript: object keys sorted by UTF-16
code units, no whitespace, and every string and number written exactly as
``JSON.stringify`` writes it. This module reproduces that in Python, including
the parts ``json.dumps`` gets different:

* keys sort by UTF-16 code units, not by code points (they differ for
  characters above U+FFFF against U+E000..U+FFFF);
* numbers use the ECMAScript ``Number::toString`` format (``65.0`` is ``65``,
  ``1e21`` is ``1e+21``, ``0.000001`` is ``0.000001``, ``1e-7`` is ``1e-7``);
* a lone surrogate in a string is written as a ``\\udxxx`` escape.

Integers beyond 2**53 are written the way the server sees them: JSON numbers
are IEEE doubles in JavaScript, so such an integer is first rounded to the
nearest double, exactly as the server's JSON parser rounded it.

Values JSON can't represent (NaN, infinities, bytes, sets, objects with
non-string keys, ...) raise ``ValueError`` instead of being dropped.
"""
from __future__ import annotations

import hashlib
import math
import json
import re
from base64 import urlsafe_b64encode
from typing import Any, Mapping, Optional

__all__ = ["canonical_json", "payload_hash", "summary_hash", "approval_challenge", "key_fingerprint", "CHALLENGE_PREFIX"]

#: Domain separator of the approval challenge (version 2 of the format).
CHALLENGE_PREFIX = "gipity-approval:v2|"

_MAX_SAFE_INTEGER = 2**53

_SHORT_ESCAPES = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}
# Characters JSON.stringify escapes: quote, backslash, C0 controls, lone surrogates.
_NEEDS_ESCAPE = re.compile('["\\\\\x00-\x1f\ud800-\udfff]')


def _escape_char(match: re.Match[str]) -> str:
    ch = match.group(0)
    short = _SHORT_ESCAPES.get(ch)
    return short if short is not None else f"\\u{ord(ch):04x}"


def _js_string(value: str) -> str:
    # A Python str holding a surrogate PAIR as two code points (only possible
    # with surrogatepass decoding) is joined first, as JavaScript sees one char.
    if any("\ud800" <= c <= "\udfff" for c in value):
        value = value.encode("utf-16", "surrogatepass").decode("utf-16", "surrogatepass")
    return '"' + _NEEDS_ESCAPE.sub(_escape_char, value) + '"'


def _js_number(value: float) -> str:
    """ECMAScript Number::toString(10) for a finite double."""
    if not math.isfinite(value):
        raise ValueError("payload contains a non-finite number")
    if value == 0:
        return "0"  # also -0, as JavaScript writes it
    if value < 0:
        return "-" + _js_number(-value)
    # repr() is the shortest digit string that round-trips, the same digits
    # JavaScript picks; only the layout differs.
    mantissa, _, exp_part = repr(value).partition("e")
    exponent = int(exp_part) if exp_part else 0
    int_part, _, frac_part = mantissa.partition(".")
    digits = (int_part + frac_part).lstrip("0")
    exponent -= len(frac_part)
    stripped = digits.rstrip("0")
    exponent += len(digits) - len(stripped)
    digits = stripped
    k = len(digits)
    n = k + exponent  # value = 0.digits * 10**n
    if k <= n <= 21:
        return digits + "0" * (n - k)
    if 0 < n <= 21:
        return digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return "0." + "0" * (-n) + digits
    e = n - 1
    sign = "+" if e >= 0 else "-"
    head = digits if k == 1 else digits[0] + "." + digits[1:]
    return f"{head}e{sign}{abs(e)}"


def _utf16_key(key: str) -> bytes:
    return key.encode("utf-16-be", "surrogatepass")


def canonical_json(value: Any) -> str:
    """Return the RFC 8785 canonical JSON of ``value``, as the server builds it.

    Accepts ``None``, ``bool``, ``int``, ``float``, ``str``, lists/tuples and
    dicts with string keys. Raises ``ValueError`` for anything else.
    """
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _js_string(value)
    if isinstance(value, int):
        if abs(value) <= _MAX_SAFE_INTEGER:
            return str(value)
        try:
            return _js_number(float(value))
        except OverflowError:
            raise ValueError("payload contains an integer too large for a JSON number") from None
    if isinstance(value, float):
        return _js_number(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_json(v) for v in value) + "]"
    if isinstance(value, dict):
        for key in value:
            if not isinstance(key, str):
                raise ValueError(f"payload object key {key!r} is not a string")
        keys = sorted(value, key=_utf16_key)
        return "{" + ",".join(_js_string(k) + ":" + canonical_json(value[k]) for k in keys) + "}"
    raise ValueError(f"payload contains a value JSON can't represent ({type(value).__name__})")


def payload_hash(payload: Any) -> str:
    """Lowercase hex SHA-256 of the canonical JSON of ``payload``."""
    return hashlib.sha256(canonical_json(payload).encode("utf-8", "surrogatepass")).hexdigest()


def b64url(data: bytes) -> str:
    """base64url without padding, as WebAuthn writes binary fields."""
    return urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def summary_hash(summary: str, details: Optional[str]) -> str:
    """Hex SHA-256 of the canonical JSON of ``{"details": details or null, "summary": summary}``:
    the words the approver read, which the passkey signs too."""
    return payload_hash({"summary": summary, "details": details})


def approval_challenge(approval_id: str, payload_hash_hex: str, summary_hash_hex: str, expires_at: str) -> str:
    """The WebAuthn challenge of an approval, base64url (no padding).

    ``sha256("gipity-approval:v2|" + id + "|" + payloadHash + "|" + summaryHash + "|" + expiresAt)``,
    with ``expires_at`` exactly as the server returned it.
    """
    text = f"{CHALLENGE_PREFIX}{approval_id}|{payload_hash_hex}|{summary_hash_hex}|{expires_at}"
    return b64url(hashlib.sha256(text.encode("utf-8")).digest())


def key_fingerprint(jwk: Mapping[str, Any]) -> str:
    """The passkey fingerprint Gipity shows on its passkey pages: the first 16 hex
    characters of the RFC 7638 JWK thumbprint, in groups of four ("3f2a 9c1d 77b0 e412").
    Compare it with https://a.gipity.ai/approvals/passkeys before pinning a key."""
    kty = jwk.get("kty")
    names = {"EC": ("crv", "kty", "x", "y"), "OKP": ("crv", "kty", "x"), "RSA": ("e", "kty", "n")}.get(str(kty))
    if names is None or any(not isinstance(jwk.get(n), str) for n in names):
        raise ValueError("not an EC, OKP or RSA public key")
    members = json.dumps({n: jwk[n] for n in names}, separators=(",", ":"))
    digest = hashlib.sha256(members.encode("utf-8")).hexdigest()[:16]
    return " ".join(digest[i:i + 4] for i in range(0, 16, 4))
