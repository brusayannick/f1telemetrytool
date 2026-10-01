"""FastF1 loading helpers for the ingestion worker."""

from __future__ import annotations

import os
from pathlib import Path

import fastf1


def init_cache(cache_dir: str | None = None) -> str:
    """Configure the FastF1 cache directory and return its path."""
    raw = cache_dir or os.environ.get("FASTF1_CACHE") or "~/.cache/fastf1"
    cache = Path(os.path.expanduser(raw))
    cache.mkdir(parents=True, exist_ok=True)

    configure = getattr(fastf1.Cache, "configure", None) or getattr(
        fastf1.Cache, "enable_cache"
    )
    configure(str(cache))
    fastf1.set_log_level("WARNING")
    return str(cache)


def load_session(
    year: int,
    gp: str | int,
    identifier: str | int,
    *,
    telemetry: bool = True,
):
    """Load a session with laps, telemetry, weather and race control data."""
    session = fastf1.get_session(year, gp, identifier)
    session.load(laps=True, telemetry=telemetry, weather=True, messages=True)
    return session
