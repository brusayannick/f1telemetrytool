"""Normalization of FastF1 session objects into Convex-friendly payloads.

Telemetry is stored as columnar little-endian float32 arrays packed with
msgpack and gzip-compressed (``format``: ``msgpack+gzip/float32le``).
Channel names and order are recorded in the metadata so the web client can
decode the payload without guessing.
"""

from __future__ import annotations

import gzip
from typing import Any

import msgpack
import numpy as np
import pandas as pd

TELEMETRY_FORMAT = "msgpack+gzip/float32le"
TELEMETRY_CHANNELS = [
    "t",      # ms since first sample of the driver's session telemetry
    "dist",   # meters driven since start of slice
    "speed",  # km/h
    "rpm",    # engine rpm
    "gear",   # gear number (0 = neutral)
    "thr",    # throttle 0-100 %
    "brk",    # brake 0 or 100
    "drs",    # DRS code (0-14)
    "x",      # position, 1/10 m
    "y",
    "z",
]

SESSION_NAMES = {
    "R": "Race",
    "S": "Sprint",
    "SQ": "Sprint Qualifying",
    "SS": "Sprint Shootout",
    "Q": "Qualifying",
    "FP1": "Practice 1",
    "FP2": "Practice 2",
    "FP3": "Practice 3",
}


# -- scalar helpers ---------------------------------------------------------


def _clean(value: Any) -> Any:
    """Recursively convert numpy scalars to JSON-serializable Python types."""
    if isinstance(value, dict):
        return {key: _clean(entry) for key, entry in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(entry) for entry in value]
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def _num(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _ms(value: Any) -> int | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        return None
    try:
        return int(round(pd.Timedelta(value).total_seconds() * 1000))
    except (TypeError, ValueError):
        return None


def _opt_str(value: Any) -> str | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        return None
    text = str(value).strip()
    return text or None


def _slug(name: Any) -> str:
    text = str(name or "unknown").strip().lower()
    return "_".join(part for part in text.replace("-", " ").split() if part)


def _session_type(name: str) -> str:
    lowered = name.lower()
    if "race" in lowered or "sprint" in lowered and "qualif" not in lowered:
        return "Race"
    if "qualifying" in lowered or "shootout" in lowered:
        return "Qualifying"
    if "practice" in lowered:
        return "Practice"
    return name


# -- session metadata ---------------------------------------------------------


def _event_field(event: Any, *keys: str) -> Any:
    """Read an event field, tolerant of FastF1 renaming across versions.

    ``fastf1.events.Event`` is a pandas Series (one row of the event schedule),
    so fields are read by column name. Older releases exposed ``Name``/``Format``
    while current ones expose ``EventName``/``EventFormat``.
    """
    for key in keys:
        try:
            value = event.get(key)
        except AttributeError:
            value = getattr(event, key, None)
        if value is None:
            continue
        try:
            if pd.isna(value):
                continue
        except (TypeError, ValueError):
            pass
        return value
    return None


def session_meta(session) -> dict[str, Any]:
    """Build season/event/session upsert payloads from a loaded FastF1 session."""
    event = session.event
    start_ms = int(pd.Timestamp(session.date).timestamp() * 1000)

    # Prefer the scheduled UTC session start when the schedule provides it.
    for index in range(1, 6):
        if _event_field(event, f"Session{index}") == session.name:
            scheduled = _event_field(event, f"Session{index}DateUtc")
            if scheduled is not None:
                start_ms = int(pd.Timestamp(scheduled).timestamp() * 1000)
            break

    end_ms = start_ms + (
        2 * 3_600_000 if _session_type(session.name) == "Race" else 3_600_000
    )
    try:
        laps = session.laps
        if laps is not None and len(laps) > 0:
            last = pd.Timedelta(laps["Time"].max())
            end_ms = start_ms + int(last.total_seconds() * 1000) + 300_000
    except Exception:  # noqa: BLE001 - best effort only
        pass

    weekend_dates = []
    for index in range(1, 6):
        value = _event_field(event, f"Session{index}DateUtc")
        if value is not None:
            weekend_dates.append(pd.Timestamp(value))
    weekend_start_ms = (
        int(min(weekend_dates).timestamp() * 1000) if weekend_dates else start_ms
    )
    weekend_end_ms = (
        int(max(weekend_dates).timestamp() * 1000) + 3_600_000
        if weekend_dates
        else end_ms
    )

    return {
        "year": int(pd.Timestamp(session.date).year),
        "event": {
            "round": int(_event_field(event, "RoundNumber") or 0),
            "name": str(_event_field(event, "EventName", "Name") or ""),
            "officialName": _opt_str(
                _event_field(event, "OfficialEventName", "OfficialName")
            ),
            "country": str(_event_field(event, "Country") or ""),
            "location": _opt_str(_event_field(event, "Location")),
            "startDate": weekend_start_ms,
            "endDate": weekend_end_ms,
            "format": _opt_str(_event_field(event, "EventFormat", "Format")),
        },
        "session": {
            "name": session.name,
            "type": _session_type(session.name),
            "startTime": start_ms,
            "endTime": end_ms,
        },
    }


def driver_numbers(session) -> list[str]:
    try:
        values = session.laps["DriverNumber"].dropna().unique().tolist()
    except Exception:  # noqa: BLE001
        return []
    return sorted(str(value) for value in values)


# -- row builders -------------------------------------------------------------


def results_rows(session) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    results = session.results
    if results is None or len(results) == 0:
        return rows

    for _, r in results.iterrows():
        code = r.get("Abbreviation")
        driver_ergast = r.get("DriverId")
        ergast_driver_id = (
            str(driver_ergast)
            if isinstance(driver_ergast, str) and driver_ergast
            else (str(code).lower() if isinstance(code, str) and code else None)
        )
        team_ergast = r.get("TeamId")
        ergast_team_id = (
            str(team_ergast)
            if isinstance(team_ergast, str) and team_ergast
            else _slug(r.get("TeamName"))
        )
        if not ergast_driver_id or not ergast_team_id:
            continue

        rows.append(
            _clean(
                {
                    "ergastDriverId": ergast_driver_id,
                    "ergastTeamId": ergast_team_id,
                    "code": str(code or ""),
                    "firstName": str(r.get("FirstName") or ""),
                    "lastName": str(r.get("LastName") or ""),
                    "teamName": str(r.get("TeamName") or ""),
                    "teamColor": _opt_str(r.get("TeamColor")),
                    "driverNumber": str(r.get("DriverNumber") or ""),
                    "position": _num(r.get("Position")),
                    "classifiedPosition": _opt_str(r.get("ClassifiedPosition")),
                    "gridPosition": _num(r.get("GridPosition")),
                    "q1Ms": _ms(r.get("Q1")),
                    "q2Ms": _ms(r.get("Q2")),
                    "q3Ms": _ms(r.get("Q3")),
                    "timeMs": _ms(r.get("Time")),
                    "status": _opt_str(r.get("Status")),
                    "points": _num(r.get("Points")),
                    "laps": _num(r.get("Laps")),
                }
            )
        )
    return rows


def laps_rows(session, driver_number: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    laps = session.laps.pick_drivers(driver_number)
    if laps is None or len(laps) == 0:
        return rows

    for _, lap in laps.iterrows():
        rows.append(
            _clean(
                {
                    "lapNumber": int(lap["LapNumber"]),
                    "lapTimeMs": _ms(lap.get("LapTime")),
                    "lapStartMs": _ms(lap.get("LapStartTime")),
                    "s1Ms": _ms(lap.get("Sector1Time")),
                    "s2Ms": _ms(lap.get("Sector2Time")),
                    "s3Ms": _ms(lap.get("Sector3Time")),
                    "compound": _opt_str(lap.get("Compound")),
                    "tyreLife": _num(lap.get("TyreLife")),
                    "freshTyre": bool(lap["FreshTyre"]) if not pd.isna(lap.get("FreshTyre")) else None,
                    "stint": _num(lap.get("Stint")),
                    "pitIn": None if pd.isna(lap.get("PitInTime")) else True,
                    "pitOut": None if pd.isna(lap.get("PitOutTime")) else True,
                    "isAccurate": bool(lap["IsAccurate"]) if "IsAccurate" in lap and not pd.isna(lap.get("IsAccurate")) else None,
                    "trackStatus": _opt_str(lap.get("TrackStatus")),
                    "position": _num(lap.get("Position")),
                    "speedI1": _num(lap.get("SpeedI1")),
                    "speedI2": _num(lap.get("SpeedI2")),
                    "speedFL": _num(lap.get("SpeedFL")),
                    "speedST": _num(lap.get("SpeedST")),
                }
            )
        )
    return rows


def stints_rows(session, driver_number: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    laps = session.laps.pick_drivers(driver_number)
    if laps is None or len(laps) == 0:
        return rows

    for stint_number, group in laps.groupby("Stint"):
        if pd.isna(stint_number):
            continue
        first = group.iloc[0]
        rows.append(
            _clean(
                {
                    "stintNumber": int(stint_number),
                    "compound": _opt_str(first.get("Compound")),
                    "lapStart": _num(group["LapNumber"].min()),
                    "lapEnd": _num(group["LapNumber"].max()),
                    "tyreAgeAtStart": _num(first.get("TyreLife")),
                }
            )
        )
    return rows


# -- telemetry payload ---------------------------------------------------------


def telemetry_payload(
    session, driver_number: str
) -> tuple[bytes, dict[str, Any]] | None:
    """Return (gzip-compressed msgpack bytes, info) for one driver's session."""
    laps = session.laps.pick_drivers(driver_number)
    telemetry = laps.get_telemetry(frequency="original")
    if telemetry is None or len(telemetry) == 0:
        return None

    t_ms = (
        telemetry["SessionTime"]
        .astype("timedelta64[ms]")
        .astype("int64")
        .to_numpy()
    )
    # relative timestamps keep float32 precision lossless (values stay small)
    t_rel = (t_ms - t_ms[0]).astype("<f4")

    channels: dict[str, np.ndarray] = {
        "t": t_rel,
        "dist": telemetry["Distance"].to_numpy(dtype="float32"),
        "speed": telemetry["Speed"].to_numpy(dtype="float32"),
        "rpm": telemetry["RPM"].to_numpy(dtype="float32"),
        "gear": telemetry["nGear"].to_numpy(dtype="float32"),
        "thr": telemetry["Throttle"].to_numpy(dtype="float32"),
        "brk": (telemetry["Brake"].astype("float32") * 100.0).to_numpy(dtype="float32"),
        "drs": telemetry["DRS"].to_numpy(dtype="float32"),
        "x": telemetry["X"].to_numpy(dtype="float32"),
        "y": telemetry["Y"].to_numpy(dtype="float32"),
        "z": telemetry["Z"].to_numpy(dtype="float32"),
    }

    payload = {
        "n": int(len(t_rel)),
        "order": TELEMETRY_CHANNELS,
        "channels": {name: channels[name].tobytes() for name in TELEMETRY_CHANNELS},
    }
    packed = msgpack.packb(payload, use_bin_type=True)
    data = gzip.compress(packed, compresslevel=6)

    info = {
        "format": TELEMETRY_FORMAT,
        "channels": TELEMETRY_CHANNELS,
        "sampleCount": int(len(t_rel)),
        "bytes": len(data),
        "freqHz": None,
    }
    return data, info
