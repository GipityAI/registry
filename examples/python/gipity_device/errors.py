"""Errors raised by the Gipity device client."""
from __future__ import annotations

from typing import Optional

__all__ = ["GipityError"]


class GipityError(Exception):
    """A request the Gipity API refused or could not complete.

    Attributes:
        status: The HTTP status (``0`` when the request never got a response).
        code: The API's error code, e.g. ``FORBIDDEN`` or ``NOT_FOUND``.
        message: The API's human-readable message.
    """

    def __init__(self, status: int, code: str, message: str, *, retry_after: Optional[float] = None) -> None:
        super().__init__(f"{status} {code}: {message}" if status else f"{code}: {message}")
        self.status = status
        self.code = code
        self.message = message
        self.retry_after = retry_after
