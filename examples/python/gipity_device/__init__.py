"""Gipity device client: a Python device or script talking to a Gipity app.

Functions, Records (read, create, and a change stream that never misses an
event), uploads of any size, and offline verification of passkey approvals.
"""
from __future__ import annotations

__version__ = "0.1.0"

from .approvals import DEFAULT_ORIGIN, VerifyCheck, VerifyResult, verify_approval
from .canonical import approval_challenge, canonical_json, payload_hash
from .client import DEFAULT_BASE_URL, Client, Functions, RecordPage, Records
from .errors import GipityError
from .sse import CursorStore, FileCursor, RecordEvent, Subscription

__all__ = [
    "__version__",
    "Client",
    "Functions",
    "Records",
    "RecordPage",
    "RecordEvent",
    "Subscription",
    "CursorStore",
    "FileCursor",
    "GipityError",
    "verify_approval",
    "VerifyResult",
    "VerifyCheck",
    "canonical_json",
    "payload_hash",
    "approval_challenge",
    "DEFAULT_BASE_URL",
    "DEFAULT_ORIGIN",
]
