"""Telemetry blob storage.

One telemetry payload is ~1 MiB per driver-session and a full history is several
gigabytes, so the blobs belong in object storage rather than the Convex database's
file storage (whose free tier is 0.5 GB). Two backends:

* :class:`R2BlobStore` — Cloudflare R2 through the S3 API, used when the ``R2_*``
  variables are configured.
* :class:`ConvexBlobStore` — Convex file storage, the default and the local-development
  fallback.

:func:`build_blob_store` selects one from the environment, so moving between them is a
configuration change rather than a code change. Both describe the result with a
:class:`BlobRef`, which the worker forwards to Convex so queries can resolve a URL.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Protocol

from .convex_client import ConvexIngestClient


@dataclass(frozen=True)
class BlobRef:
    """Where a telemetry payload was stored."""

    provider: str
    storage_id: str | None = None
    storage_key: str | None = None


class BlobStore(Protocol):
    def put(self, key: str, data: bytes) -> BlobRef:
        """Store ``data`` under ``key`` and describe where it went."""


def telemetry_key(
    year: int, round_number: int, session_name: str, driver_number: str
) -> str:
    """Deterministic object key, so re-ingesting a session overwrites in place."""
    slug = re.sub(r"[^a-z0-9]+", "-", session_name.lower()).strip("-")
    return f"telemetry/{year}/round-{round_number:02d}/{slug}/{driver_number}.msgpack.gz"


class ConvexBlobStore:
    """Store telemetry in Convex file storage (small datasets, local development)."""

    def __init__(self, client: ConvexIngestClient) -> None:
        self._client = client

    def put(self, key: str, data: bytes) -> BlobRef:  # noqa: ARG002 - key is implicit
        storage_id = self._client.upload_telemetry(data)
        return BlobRef(provider="convex", storage_id=storage_id)


class R2BlobStore:
    """Store telemetry in Cloudflare R2 via the S3 API.

    The payload is already gzip-compressed and the client decompresses it explicitly,
    so no ``Content-Encoding`` header is set — that would make browsers double-decompress.
    """

    def __init__(
        self, bucket: str, account_id: str | None = None, endpoint: str | None = None
    ) -> None:
        import boto3  # imported lazily: the Convex fallback must not require it

        resolved_endpoint = endpoint or os.environ.get("R2_ENDPOINT") or (
            f"https://{account_id}.r2.cloudflarestorage.com" if account_id else None
        )
        if not resolved_endpoint:
            raise RuntimeError("Set R2_ENDPOINT or R2_ACCOUNT_ID to use R2 storage")

        self._bucket = bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=resolved_endpoint,
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )

    def put(self, key: str, data: bytes) -> BlobRef:
        self._client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ContentType="application/octet-stream",
            CacheControl="public, max-age=31536000, immutable",
        )
        return BlobRef(provider="r2", storage_key=key)


def build_blob_store(client: ConvexIngestClient | None = None) -> BlobStore:
    """Select a backend from the environment (R2 when configured, else Convex)."""
    bucket = os.environ.get("R2_BUCKET")
    if (
        bucket
        and os.environ.get("R2_ACCESS_KEY_ID")
        and os.environ.get("R2_SECRET_ACCESS_KEY")
    ):
        return R2BlobStore(bucket=bucket, account_id=os.environ.get("R2_ACCOUNT_ID"))

    if client is None:
        raise RuntimeError(
            "A ConvexIngestClient is required for the Convex blob store fallback"
        )
    return ConvexBlobStore(client)
