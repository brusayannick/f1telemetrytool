"""Thin HTTP client for the platform's Convex ingestion + query endpoints.

Ingestion goes through Convex HTTP actions under ``/ingest/*`` on the
deployment's ``convex.site`` domain and is protected by a shared secret
(``x-ingest-secret``). Public queries are read from the regular functions
API on the ``convex.cloud`` domain.
"""

from __future__ import annotations

import os
from typing import Any

import requests


class IngestError(RuntimeError):
    """Raised when the Convex ingestion API returns an error."""


def _prune_nulls(value: Any) -> Any:
    """Drop ``None`` values recursively before sending arguments to Convex.

    Convex optional validators accept ``undefined`` but reject ``null``, while
    Python serialises ``None`` as JSON ``null``. Absent optional fields must
    therefore be omitted rather than sent as null.
    """
    if isinstance(value, dict):
        return {
            key: _prune_nulls(entry)
            for key, entry in value.items()
            if entry is not None
        }
    if isinstance(value, list):
        return [_prune_nulls(entry) for entry in value]
    return value


def _request(method: str, url: str, **kwargs: Any) -> requests.Response:
    """Perform an HTTP request, turning transport failures into :class:`IngestError`.

    A transient timeout or connection reset must not surface as an unhandled
    exception: callers — notably the long-running ``watch`` daemon — treat
    ``IngestError`` as retryable and carry on. Without this, one slow response kills
    the worker it is meant to keep running.
    """
    try:
        return requests.request(method, url, **kwargs)
    except requests.RequestException as err:
        raise IngestError(f"{url}: {type(err).__name__}: {err}") from err


class ConvexIngestClient:
    def __init__(
        self,
        site_url: str | None = None,
        cloud_url: str | None = None,
        secret: str | None = None,
        timeout: float = 120.0,
    ) -> None:
        self.site_url = (site_url or os.environ.get("CONVEX_SITE_URL") or "").rstrip("/")
        self.cloud_url = (cloud_url or os.environ.get("CONVEX_URL") or "").rstrip("/")
        self.secret = secret or os.environ.get("INGEST_SECRET") or ""
        self.timeout = timeout
        if not self.site_url or not self.secret:
            raise IngestError(
                "CONVEX_SITE_URL and INGEST_SECRET must be set "
                "(see ingest/.env.example)."
            )

    # -- low level ---------------------------------------------------------

    def _post(self, path: str, payload: dict[str, Any]) -> Any:
        response = _request(
            "post",
            f"{self.site_url}/ingest/{path}",
            json=_prune_nulls(payload),
            headers={"x-ingest-secret": self.secret},
            timeout=self.timeout,
        )
        if response.status_code != 200:
            raise IngestError(f"{path}: HTTP {response.status_code}: {response.text[:500]}")
        data = response.json()
        if not data.get("ok"):
            raise IngestError(f"{path}: {data.get('error', data)}")
        return data.get("value")

    def query(self, path: str, args: dict[str, Any]) -> Any:
        if not self.cloud_url:
            raise IngestError("CONVEX_URL must be set to use public queries.")
        response = _request(
            "post",
            f"{self.cloud_url}/api/query",
            json={"path": path, "args": args, "format": "json"},
            timeout=self.timeout,
        )
        response.raise_for_status()
        data = response.json()
        if data.get("status") != "success":
            raise IngestError(f"query {path}: {data.get('errorMessage', data)}")
        return data.get("value")

    # -- ingestion endpoints ------------------------------------------------

    def upsert_season(self, year: int) -> str:
        return self._post("upsertSeason", {"year": year})

    def upsert_event(self, season_id: str, event: dict[str, Any]) -> str:
        return self._post("upsertEvent", {"seasonId": season_id, **event})

    def upsert_session(self, event_id: str, session: dict[str, Any]) -> str:
        return self._post("upsertSession", {"eventId": event_id, **session})

    def upsert_event_corners(
        self, event_id: str, corners: list[dict[str, Any]]
    ) -> str:
        return self._post(
            "upsertEventCorners", {"eventId": event_id, "corners": corners}
        )

    def set_session_status(
        self,
        session_id: str,
        status: str,
        *,
        telemetry: str | None = None,
        error: str | None = None,
    ) -> None:
        payload = {"sessionId": session_id, "status": status}
        if telemetry is not None:
            payload["telemetry"] = telemetry
        if error is not None:
            payload["error"] = error
        self._post("setSessionStatus", payload)

    def upsert_results(self, session_id: str, rows: list[dict[str, Any]]) -> int:
        return self._post("upsertResults", {"sessionId": session_id, "rows": rows})

    def upsert_laps(
        self, session_id: str, driver_number: str, laps: list[dict[str, Any]]
    ) -> int:
        return self._post(
            "upsertLaps",
            {"sessionId": session_id, "driverNumber": driver_number, "laps": laps},
        )

    def upsert_stints(
        self, session_id: str, driver_number: str, stints: list[dict[str, Any]]
    ) -> int:
        return self._post(
            "upsertStints",
            {"sessionId": session_id, "driverNumber": driver_number, "stints": stints},
        )

    def upload_telemetry(self, data: bytes) -> str:
        """Upload a binary payload and return the Convex storage id."""
        upload_url = self._post("uploadUrl", {})
        response = _request(
            "post",
            upload_url,
            data=data,
            headers={"Content-Type": "application/octet-stream"},
            timeout=self.timeout,
        )
        response.raise_for_status()
        storage_id = response.json().get("storageId")
        if not storage_id:
            raise IngestError(f"upload failed: {response.text[:300]}")
        return storage_id

    def attach_telemetry(
        self,
        session_id: str,
        driver_number: str,
        reference: Any,
        *,
        format: str,
        channels: list[str],
        sample_count: int,
        bytes: int,
        freq_hz: float | None = None,
    ) -> str:
        payload: dict[str, Any] = {
            "sessionId": session_id,
            "driverNumber": driver_number,
            "provider": getattr(reference, "provider", "convex"),
            "format": format,
            "channels": channels,
            "sampleCount": sample_count,
            "bytes": bytes,
        }
        storage_id = getattr(reference, "storage_id", None)
        storage_key = getattr(reference, "storage_key", None)
        if storage_id is not None:
            payload["storageId"] = storage_id
        if storage_key is not None:
            payload["storageKey"] = storage_key
        if freq_hz is not None:
            payload["freqHz"] = freq_hz
        return self._post("attachTelemetry", payload)

    def status_for(self, year: int, round_number: int, name: str) -> dict[str, Any] | None:
        return self.query(
            "sessions:statusFor", {"year": year, "round": round_number, "name": name}
        )

    def storage_usage(self) -> dict[str, Any]:
        """Convex telemetry storage footprint (files + bytes)."""
        return self.query("telemetry:storageUsage", {})

    def heartbeat(self, deployment: str) -> None:
        """Announce that a worker is watching this deployment.

        Stored in the deployment, so a deployment with no worker shows no heartbeat and
        the web UI can say so instead of waiting silently forever.
        """
        self._post("heartbeat", {"deployment": deployment})
