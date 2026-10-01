"""Unsupervised anomaly detection over stored lap telemetry.

Two ideas are deliberately kept apart:

* **feature extraction** turns each lap into a small, interpretable vector — speed and
  pedal duty per equal-distance segment — so a flag can always be explained in racing
  terms ("slower minimum speed through segment 6") instead of as an opaque distance in
  some latent space.
* **scoring** compares a lap against the *same driver's* other laps in the session. That
  personal baseline controls for the car, fuel load and track conditions, so what stands
  out is the driving; a field-relative baseline would mostly find car differences.

Run over a session:

    python -m ingest.anomaly --session-id <convex session id>

Pit in/out laps, inaccurate laps and laps run under anything other than green track
status are excluded from the baseline and not scored: they are legitimately different,
and flagging them would be noise.
"""

from __future__ import annotations

import argparse
import gzip
import sys
from pathlib import Path
from typing import Any

import msgpack
import numpy as np
import requests
from dotenv import load_dotenv

from .convex_client import ConvexIngestClient, IngestError

#: Equal-distance segments per lap. Ten keeps the feature names readable and still
#: resolves an individual corner complex.
SEGMENTS = 10

#: Minimum laps a driver needs before a personal baseline means anything.
MIN_LAPS = 5

#: Laps slower than this multiple of the driver's best are not driving anomalies but
#: unrepresentative laps (preparation, a spin, an aborted run). They are reported
#: separately and kept out of the baseline, where they would otherwise inflate it.
UNREPRESENTATIVE_RATIO = 1.07

#: Scale cap for z-scores — see robust_z().
Z_CLIP = 12.0


def fetch_telemetry(url: str, timeout: float = 120.0) -> dict[str, Any]:
    """Download one driver-session telemetry payload (gzip + msgpack)."""
    response = requests.get(url, timeout=timeout)
    response.raise_for_status()
    return msgpack.unpackb(gzip.decompress(response.content), raw=False)


def channels_of(payload: dict[str, Any]) -> dict[str, np.ndarray]:
    order = payload.get("order") or list(payload["channels"])
    out: dict[str, np.ndarray] = {}
    for name in order:
        raw = payload["channels"].get(name)
        if raw is None:
            continue
        out[name] = np.frombuffer(raw, dtype="<f4")
    return out


def slice_lap(
    channels: dict[str, np.ndarray], t0_ms: float, lap: dict[str, Any]
) -> tuple[int, int] | None:
    """Sample range covering one lap — mirrors ``lapRange()`` in src/lib/telemetry.ts."""
    start_ms = lap.get("lapStartMs")
    duration = lap.get("lapTimeMs")
    if start_ms is None or duration is None:
        return None

    times = channels["t"]
    start = int(np.searchsorted(times, start_ms - t0_ms, "left"))
    end = int(np.searchsorted(times, start_ms - t0_ms + duration, "left"))
    if end - start < 50:
        return None
    return start, end


def lap_features(
    channels: dict[str, np.ndarray], start: int, end: int
) -> dict[str, float] | None:
    """Interpretable per-lap feature vector."""
    dist = channels["dist"][start:end]
    speed = channels["speed"][start:end]
    throttle = channels["thr"][start:end]
    brake = channels["brk"][start:end]

    span = float(dist[-1] - dist[0]) if dist.size else 0.0
    # A pit-lane fragment or a partial lap cannot be compared with a flying lap.
    if span < 1000.0:
        return None

    features: dict[str, float] = {
        "mean_speed": float(np.mean(speed)),
        "full_throttle": float(np.mean(throttle >= 98)),
        "braking": float(np.mean(brake > 0)),
    }

    offsets = dist - dist[0]
    for segment in range(SEGMENTS):
        low = span * segment / SEGMENTS
        high = span * (segment + 1) / SEGMENTS
        mask = (offsets >= low) & (offsets < high)
        if not mask.any():
            continue
        features[f"s{segment + 1}_min_speed"] = float(np.min(speed[mask]))
        features[f"s{segment + 1}_mean_speed"] = float(np.mean(speed[mask]))
        features[f"s{segment + 1}_throttle"] = float(np.mean(throttle[mask] >= 98))
        features[f"s{segment + 1}_brake"] = float(np.mean(brake[mask] > 0))

    return features


def feature_floor(name: str) -> float:
    """Smallest difference in a feature that is worth calling a difference.

    Duty features saturate at zero: a driver brakes in one lap and not in the next, so
    the median across laps is 0 and a relative floor is 0 too — every 0.1% deviation then
    produced a z-score in the hundreds. The floor must live in the feature's own units:
    duty is a fraction of samples, speed is km/h, lap time is milliseconds.
    """
    if name.endswith(("_brake", "_throttle")) or name in {"braking", "full_throttle"}:
        return 0.02
    if name == "lap_time_ms":
        return 100.0
    return 1.0


def robust_z(values: np.ndarray, floor: float) -> np.ndarray:
    """Median/MAD standardisation with the scale floored in real units.

    A raw MAD is unusable at this sample size: when a driver's five laps are within a few
    tenths in some segment, the median absolute deviation collapses towards zero and any
    deviation produces an absurd z-score. The floor keeps scores comparable between a
    driver who is metronomic in one segment and one who is not.
    """
    median = float(np.median(values))
    mad = float(np.median(np.abs(values - median)))
    scale = max(1.4826 * mad, floor)
    return np.clip((values - median) / scale, -Z_CLIP, Z_CLIP)


def usable_lap(lap: dict[str, Any]) -> bool:
    """Whether a lap may take part in the baseline at all."""
    if lap.get("lapTimeMs") is None or lap.get("lapStartMs") is None:
        return False
    if lap.get("pitIn") or lap.get("pitOut"):
        return False
    if lap.get("isAccurate") is False:
        return False
    # trackStatus "1" is green; anything else means a safety car, VSC, yellow or red.
    return (lap.get("trackStatus") or "1") == "1"


def analyse_session(
    client: ConvexIngestClient,
    session_id: str,
    *,
    top_features: int = 3,
) -> list[dict[str, Any]]:
    """Score every clean lap in a session against its driver's own baseline."""
    files = client.query("telemetry:listTelemetryFiles", {"sessionId": session_id})
    findings: list[dict[str, Any]] = []

    for entry in files:
        driver = entry["driverNumber"]
        if not entry.get("url"):
            continue

        laps = client.query(
            "sessions:listLaps", {"sessionId": session_id, "driverNumber": driver}
        )
        payload = fetch_telemetry(entry["url"])
        t0_ms = float(payload.get("t0ms") or 0)
        channels = channels_of(payload)

        rows: list[tuple[int, dict[str, float]]] = []
        for lap in laps:
            if not usable_lap(lap):
                continue
            window = slice_lap(channels, t0_ms, lap)
            if window is None:
                continue
            features = lap_features(channels, *window)
            if features is None:
                continue
            features["lap_time_ms"] = float(lap["lapTimeMs"])
            rows.append((int(lap["lapNumber"]), features))

        if len(rows) < MIN_LAPS:
            continue

        best = min(features["lap_time_ms"] for _, features in rows)
        cutoff = best * UNREPRESENTATIVE_RATIO
        representative = [(n, f) for n, f in rows if f["lap_time_ms"] <= cutoff]
        unrepresentative = [(n, f) for n, f in rows if f["lap_time_ms"] > cutoff]

        if len(representative) < MIN_LAPS:
            continue

        names = sorted(representative[0][1])
        matrix = np.array(
            [[features[name] for name in names] for _, features in representative]
        )
        z_scores = np.column_stack(
            [
                robust_z(matrix[:, column], feature_floor(names[column]))
                for column in range(matrix.shape[1])
            ]
        )

        for index, (lap_number, features) in enumerate(representative):
            row = z_scores[index]
            order = np.argsort(-np.abs(row))
            # Aggregate the largest deviations, so one wild corner or a
            # consistently slow lap both register.
            score = float(np.sqrt(np.mean(np.sort(row**2)[-top_features:])))
            findings.append(
                {
                    "driver": driver,
                    "lapNumber": lap_number,
                    "score": score,
                    "category": "outlier",
                    "lapTimeMs": features["lap_time_ms"],
                    "baselineLaps": len(representative),
                    "topFeatures": [
                        {
                            "name": names[position],
                            "value": features[names[position]],
                            "z": float(row[position]),
                        }
                        for position in order[:top_features]
                    ],
                }
            )

        for lap_number, features in unrepresentative:
            findings.append(
                {
                    "driver": driver,
                    "lapNumber": lap_number,
                    "score": 0.0,
                    "category": "unrepresentative",
                    "lapTimeMs": features["lap_time_ms"],
                    "baselineLaps": len(representative),
                    "topFeatures": [],
                }
            )

    findings.sort(key=lambda item: -item["score"])
    return findings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="anomaly", description=__doc__)
    parser.add_argument("--session-id", required=True)
    parser.add_argument(
        "--env-file",
        default=None,
        help="Worker configuration file (default: ingest/.env)",
    )
    parser.add_argument("--top", type=int, default=12, help="How many flags to print")
    args = parser.parse_args(argv)

    load_dotenv(args.env_file or (Path(__file__).parent / ".env"))

    try:
        findings = analyse_session(ConvexIngestClient(), args.session_id)
    except IngestError as err:
        print(f"anomaly: {err}", file=sys.stderr)
        return 2

    if not findings:
        print("no scorable laps (need laps with telemetry, green track, no pit stops)")
        return 0

    outliers = [item for item in findings if item["category"] == "outlier"]
    unrepresentative = [
        item for item in findings if item["category"] == "unrepresentative"
    ]

    print(f"scored {len(outliers)} laps; most unusual first\n")
    for item in outliers[: args.top]:
        minutes, remainder = divmod(int(item["lapTimeMs"]), 60_000)
        seconds = remainder / 1000
        print(
            f"  {item['score']:5.2f}  car {item['driver']:>3} lap {item['lapNumber']:>2} "
            f"({minutes}:{seconds:06.3f}, vs {item['baselineLaps']} own laps)"
        )
        for feature in item["topFeatures"]:
            print(
                f"          {feature['name']:<18} {feature['value']:9.1f}   z {feature['z']:+.2f}"
            )

    if unrepresentative:
        print(
            f"\n{len(unrepresentative)} laps excluded as unrepresentative "
            f"(>{(UNREPRESENTATIVE_RATIO - 1) * 100:.0f}% off the driver's best — "
            f"preparation, spins, aborted runs):"
        )
        for item in sorted(unrepresentative, key=lambda i: i["lapTimeMs"])[: args.top]:
            minutes, remainder = divmod(int(item["lapTimeMs"]), 60_000)
            seconds = remainder / 1000
            print(
                f"  car {item['driver']:>3} lap {item['lapNumber']:>2} "
                f"({minutes}:{seconds:06.3f})"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
