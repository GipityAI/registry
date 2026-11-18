"""The Gipity device client: functions, Records, uploads and approvals over HTTPS."""
from __future__ import annotations

import mimetypes
import os
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import IO, TYPE_CHECKING, Any, Callable, Iterator, Mapping, Optional, Union
from urllib.parse import quote

import httpx

from . import __version__
from .errors import GipityError

if TYPE_CHECKING:
    from .sse import RecordEvent, Subscription

__all__ = ["Client", "Functions", "Records", "RecordPage", "DEFAULT_BASE_URL"]

#: The production API base.
DEFAULT_BASE_URL = "https://a.gipity.ai"

_RETRY_STATUSES_IDEMPOTENT = {502, 503, 504}
_STREAM_CHUNK = 1024 * 1024

Source = Union[str, "os.PathLike[str]", IO[bytes]]


@dataclass(frozen=True)
class RecordPage:
    """One page of a Records list: the rows and the total that match."""

    rows: list[dict[str, Any]]
    total: int


def _seg(value: str) -> str:
    return quote(str(value), safe="")


class Client:
    """A Gipity app's API, authenticated with a project API key.

    Args:
        app_guid: The app's guid (``gipity project info``).
        api_key: A project API key for this app (``gipity key create``). It is
            sent as ``X-Api-Key`` on every request to the app API, and never
            to presigned storage URLs.
        base_url: The API base, ``https://a.gipity.ai`` in production.
        timeout: Seconds to wait to connect and between bytes of a response.
        max_retries: Extra attempts for a request that failed in a way that is
            safe to repeat (see :meth:`request`).
        backoff: First retry delay in seconds; doubles each attempt, capped at
            ``max_backoff``, with jitter.

    Use it as a context manager, or call :meth:`close` when done.
    """

    def __init__(
        self,
        app_guid: str,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        *,
        timeout: float = 30.0,
        max_retries: int = 4,
        backoff: float = 0.5,
        max_backoff: float = 8.0,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if not app_guid:
            raise ValueError("app_guid is required")
        if not api_key:
            raise ValueError("api_key is required")
        self.app_guid = app_guid
        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries
        self.backoff = backoff
        self.max_backoff = max_backoff
        self._api_key = api_key
        self._sleep = sleep
        self._timeout = timeout
        self._http = httpx.Client(
            base_url=f"{self.base_url}/api/{_seg(app_guid)}",
            headers=self.auth_headers(),
            timeout=timeout,
        )
        # Presigned storage URLs carry their own signature: no API key there.
        self._storage = httpx.Client(timeout=timeout, headers={"User-Agent": self._user_agent()})
        self.fn = Functions(self)
        self.records = Records(self)

    # ── plumbing ──────────────────────────────────────────────────────────

    @staticmethod
    def _user_agent() -> str:
        return f"gipity-device-python/{__version__}"

    def auth_headers(self) -> dict[str, str]:
        """Headers that authenticate a request to this app's API."""
        return {"X-Api-Key": self._api_key, "User-Agent": self._user_agent()}

    @property
    def api_base(self) -> str:
        """``<base_url>/api/<app_guid>``, the root of every app route."""
        return f"{self.base_url}/api/{_seg(self.app_guid)}"

    def close(self) -> None:
        """Close the client's connections."""
        self._http.close()
        self._storage.close()

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def _delay(self, attempt: int, retry_after: Optional[float] = None) -> float:
        if retry_after is not None:
            return max(0.0, retry_after)
        base = min(self.max_backoff, self.backoff * (2**attempt))
        return float(base * random.uniform(0.5, 1.0))

    @staticmethod
    def _error_from(response: httpx.Response) -> GipityError:
        code, message = "HTTP_ERROR", response.reason_phrase or "Request failed"
        try:
            body = response.json()
            err = body.get("error") if isinstance(body, dict) else None
            if isinstance(err, dict):
                code = str(err.get("code") or code)
                message = str(err.get("message") or message)
        except ValueError:
            pass
        retry_after: Optional[float] = None
        header = response.headers.get("Retry-After")
        if header:
            try:
                retry_after = float(header)
            except ValueError:
                retry_after = None
        return GipityError(response.status_code, code, message, retry_after=retry_after)

    def request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: Optional[Mapping[str, Any]] = None,
    ) -> Any:
        """Call an app route and return the parsed JSON body.

        Retries, up to ``max_retries`` times with backoff:

        * any request that never reached the server (connect error or timeout);
        * any request refused with 429 before it ran (``Retry-After`` honored),
          but not a function's own ``LIMIT_EXCEEDED``;
        * a ``GET`` that got 502/503/504 or lost its response mid-way.

        A ``POST``/``PUT``/``DELETE`` whose response was lost is NOT retried: it
        may already have run. Anything else raises :class:`GipityError`.
        """
        method = method.upper()
        idempotent = method in ("GET", "HEAD")
        attempt = 0
        while True:
            try:
                response = self._http.request(method, path, json=json, params=params)
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as exc:
                if attempt >= self.max_retries:
                    raise GipityError(0, "NETWORK_ERROR", f"could not reach the Gipity API: {exc}") from exc
                self._sleep(self._delay(attempt))
                attempt += 1
                continue
            except (httpx.ReadTimeout, httpx.ReadError, httpx.RemoteProtocolError, httpx.WriteError) as exc:
                if not idempotent or attempt >= self.max_retries:
                    raise GipityError(0, "NETWORK_ERROR", f"the connection to the Gipity API failed: {exc}") from exc
                self._sleep(self._delay(attempt))
                attempt += 1
                continue

            if response.status_code < 400:
                if not response.content:
                    return None
                return response.json()

            error = self._error_from(response)
            retryable = (
                (response.status_code == 429 and error.code != "LIMIT_EXCEEDED")
                or (idempotent and response.status_code in _RETRY_STATUSES_IDEMPOTENT)
            )
            if not retryable or attempt >= self.max_retries:
                raise error
            self._sleep(self._delay(attempt, error.retry_after))
            attempt += 1

    def _data(self, method: str, path: str, **kwargs: Any) -> Any:
        body = self.request(method, path, **kwargs)
        if not isinstance(body, dict) or "data" not in body:
            raise GipityError(0, "BAD_RESPONSE", f"unexpected response from {method} {path}")
        return body["data"]

    def _object(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        data = self._data(method, path, **kwargs)
        if not isinstance(data, dict):
            raise GipityError(0, "BAD_RESPONSE", f"unexpected response from {method} {path}")
        return data

    # ── approvals ─────────────────────────────────────────────────────────

    def get_approval(self, approval_id: str) -> dict[str, Any]:
        """Read a passkey approval: ``{id, status, payloadHash, expiresAt, approver,
        resolvedAt, consumedAt, proof}``. Pass it to :func:`verify_approval`."""
        return self._object("GET", f"/approvals/{_seg(approval_id)}")

    def consume_approval(self, approval_id: str, payload_hash: str) -> bool:
        """Spend an approval, once. Returns ``True`` when this call consumed it.

        ``False`` (the API's 409) means it was not approved, has expired, was
        already consumed, or ``payload_hash`` does not match: do not act. Any
        other failure raises :class:`GipityError`. Not retried after the
        request was sent, since a lost response may hide a successful consume;
        a retry would then answer ``False`` and the device would safely not act.
        """
        try:
            data = self._data("POST", f"/approvals/{_seg(approval_id)}/consume", json={"payloadHash": payload_hash})
        except GipityError as err:
            if err.status == 409:
                return False
            raise
        return bool(isinstance(data, dict) and data.get("consumed") is True)

    # ── uploads ───────────────────────────────────────────────────────────

    def upload(
        self,
        source: Source,
        *,
        filename: Optional[str] = None,
        content_type: Optional[str] = None,
        public: bool = False,
        table: Optional[str] = None,
        record_id: Optional[str] = None,
        path: str = "uploads",
        size: Optional[int] = None,
    ) -> dict[str, Any]:
        """Upload a file of any size into the app's storage and return the stored file.

        Runs the presigned flow: ``POST /uploads/init`` -> ``PUT`` the bytes straight
        to storage (one request, or one per part for very large files) ->
        ``POST /uploads/complete``. Bytes are streamed from disk in 1 MiB
        chunks, never read into memory whole, and a failed part is re-sent.

        Args:
            source: A file path, or a binary file object open for reading. A
                file object must be seekable (so a failed part can be re-sent)
                unless ``size`` is given, in which case it is read once.
            filename: Name to store (default: the path's name).
            content_type: MIME type (default: guessed from the name).
            public: Serve it publicly instead of through signed URLs.
            table, record_id: Link the file to a record.
            path: Folder in the app's storage (default ``uploads``).
            size: Byte count; required only for a non-seekable stream.

        Returns:
            The completed file: ``{guid, name, size, content_type, url, ...}``.
        """
        owned: Optional[IO[bytes]] = None
        if isinstance(source, (str, os.PathLike)):
            file_path = Path(source)
            owned = open(file_path, "rb")  # noqa: SIM115 - closed in finally
            stream: IO[bytes] = owned
            filename = filename or file_path.name
        else:
            stream = source
            filename = filename or Path(getattr(source, "name", "") or "upload.bin").name
        try:
            seekable = stream.seekable() if hasattr(stream, "seekable") else False
            if size is None:
                if not seekable:
                    raise ValueError("a non-seekable stream needs size=")
                start = stream.tell()
                size = stream.seek(0, os.SEEK_END) - start
                stream.seek(start)
            if size <= 0:
                raise ValueError("cannot upload an empty file")
            base = stream.tell() if seekable else 0
            content_type = content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
            body: dict[str, Any] = {
                "filename": filename,
                "content_type": content_type,
                "size": size,
                "public": public,
                "path": path,
            }
            if table is not None:
                body["table"] = table
            if record_id is not None:
                body["record_id"] = record_id
            init = self._object("POST", "/uploads/init", json=body)

            if init.get("method") == "multipart":
                part_size = int(init["part_size"])
                parts = []
                for part in init["parts"]:
                    number = int(part["partNumber"])
                    offset = (number - 1) * part_size
                    length = min(part_size, size - offset)
                    etag = self._put(part["url"], stream, base + offset, length, {}, seekable)
                    parts.append({"part_number": number, "etag": etag})
                complete = {"upload_guid": init["upload_guid"], "parts": parts}
            elif init.get("method") == "PUT":
                headers = dict(init.get("headers") or {"Content-Type": content_type})
                self._put(init["url"], stream, base, size, headers, seekable)
                complete = {"upload_guid": init["upload_guid"]}
            else:
                raise GipityError(0, "BAD_RESPONSE", f"unknown upload method {init.get('method')!r}")
            return self._object("POST", "/uploads/complete", json=complete)
        finally:
            if owned is not None:
                owned.close()

    def _put(
        self,
        url: str,
        stream: IO[bytes],
        offset: int,
        length: int,
        headers: Mapping[str, str],
        seekable: bool,
    ) -> str:
        """PUT ``length`` bytes from ``offset`` to a presigned URL; returns the ETag."""
        attempt = 0
        while True:
            if seekable:
                stream.seek(offset)

            def chunks(remaining: int = length) -> Iterator[bytes]:
                while remaining > 0:
                    chunk = stream.read(min(_STREAM_CHUNK, remaining))
                    if not chunk:
                        raise GipityError(0, "SHORT_READ", "the file ended before its declared size")
                    remaining -= len(chunk)
                    yield chunk

            try:
                response = self._storage.put(
                    url,
                    content=chunks(),
                    headers={**headers, "Content-Length": str(length)},
                )
            except (httpx.TransportError,) as exc:
                if not seekable or attempt >= self.max_retries:
                    raise GipityError(0, "NETWORK_ERROR", f"upload to storage failed: {exc}") from exc
                self._sleep(self._delay(attempt))
                attempt += 1
                continue
            if response.status_code < 300:
                return str(response.headers.get("ETag", ""))
            if response.status_code >= 500 and seekable and attempt < self.max_retries:
                self._sleep(self._delay(attempt))
                attempt += 1
                continue
            raise GipityError(response.status_code, "UPLOAD_FAILED", "storage refused the upload")

    # ── streaming ─────────────────────────────────────────────────────────

    def subscribe(
        self,
        table: str,
        on_event: Callable[["RecordEvent"], None],
        last_event_id: Optional[str] = None,
        **options: Any,
    ) -> "Subscription":
        """Follow a Records table's change stream without ever missing an event.

        Returns a :class:`Subscription`; call ``run()`` to block or ``start()``
        for a background thread. See :class:`Subscription` for the options
        (``cursor_file``, ``save_cursor``, ``on_reset``, ``filter``, ...).
        """
        from .sse import Subscription

        return Subscription(self, table, on_event, last_event_id=last_event_id, **options)


class Functions:
    """``client.fn``: call the app's serverless functions."""

    def __init__(self, client: Client) -> None:
        self._client = client

    def call(self, name: str, params: Optional[Mapping[str, Any]] = None) -> Any:
        """Call function ``name`` with ``params`` as its JSON body; returns its value, unwrapped."""
        return self._client._data("POST", f"/fn/{_seg(name)}", json=dict(params or {}))


class Records:
    """``client.records``: read and create rows of the app's Records tables."""

    def __init__(self, client: Client) -> None:
        self._client = client

    def get(self, table: str, record_id: Union[str, int]) -> dict[str, Any]:
        """One row by primary key. Raises :class:`GipityError` (404) when it isn't there."""
        return self._client._object("GET", f"/records/{_seg(table)}/{_seg(str(record_id))}")

    def list(
        self,
        table: str,
        *,
        filter: Optional[str] = None,
        any: Optional[str] = None,
        sort: Optional[str] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        fields: Optional[str] = None,
        q: Optional[str] = None,
    ) -> RecordPage:
        """Rows matching the Records query params (``filter="status:eq:pending"``, ``sort="id:asc"``, ...)."""
        params = {
            k: v
            for k, v in {
                "filter": filter, "any": any, "sort": sort, "limit": limit,
                "offset": offset, "fields": fields, "q": q,
            }.items()
            if v is not None
        }
        body = self._client.request("GET", f"/records/{_seg(table)}", params=params)
        if not isinstance(body, dict) or not isinstance(body.get("data"), list):
            raise GipityError(0, "BAD_RESPONSE", f"unexpected response listing {table}")
        total = body.get("meta", {}).get("total", len(body["data"]))
        return RecordPage(rows=body["data"], total=int(total))

    def create(self, table: str, data: Mapping[str, Any]) -> dict[str, Any]:
        """Insert a row (validated and audited like every Records write); returns it."""
        return self._client._object("POST", f"/records/{_seg(table)}", json=dict(data))

