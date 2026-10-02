"""Can lateral acceleration be recovered from the telemetry we actually store?

`a_lat = v * dpsi/dt = v^2 * kappa`. Both forms need a *second* derivative of the
position channel, and the position channel is the weakest data we have:

- it is only present in ``PosData`` (CarData has no X/Y), sampled ~7 Hz, quantised
  to 0.1 m;
- ``telemetry_payload`` stores ``laps.get_telemetry(frequency="original")``, i.e. the
  merged car+pos time base with interpolated positions, so between two real samples the
  path is piecewise *linear*.

This script measures whether the result is a usable number or interpolation noise, using
three independent formulations and one global closure test:

- **A** path-frame second difference: ``a_lat = (d2r/dt2) . n_hat``
- **B** circumradius curvature: ``a_lat = v^2 * kappa``
- **C** heading rate: ``a_lat = v * dpsi/dt``

Closure test: on a closed lap the total heading change is exactly 2*pi, so
``|sum(kappa * ds)|`` must come out at 2*pi no matter how the track is shaped. That is a
global check no local smoothing can fake.

Run: ``.venv/bin/python -m analysis.lateral_accel``
"""

from __future__ import annotations

import gzip
import os
import sys

# The repo root must be importable for `ingest.*` to resolve. Running this file directly
# puts the script's own directory on the path instead, which is why it used to fail with
# ModuleNotFoundError.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import msgpack
import numpy as np
import requests
from dotenv import load_dotenv

SESSION_ID = "k17dvgphqk3s86atmc2mvnp2cx8fe6z5"  # 2025 Abu Dhabi qualifying
DRIVER = "1"
G = 9.80665
TWO_PI = 2 * np.pi


def load_payload(driver: str = DRIVER) -> tuple[dict[str, np.ndarray], int]:
    load_dotenv("ingest/.env", override=True)
    from ingest.convex_client import ConvexIngestClient

    client = ConvexIngestClient()
    files = client.query("telemetry:listTelemetryFiles", {"sessionId": SESSION_ID})
    entry = next(item for item in files if item["driverNumber"] == driver)
    url = entry.get("url") or entry.get("storageUrl") or entry.get("fileUrl")
    raw = requests.get(url, timeout=120).content
    payload = msgpack.unpackb(gzip.decompress(raw), raw=False)
    channels = {
        name: np.frombuffer(buf, dtype="<f4").astype(np.float64)
        for name, buf in payload["channels"].items()
    }
    # absolute session time of sample 0: lap times are absolute, `t` is relative to this
    return channels, int(payload.get("t0ms", 0))


def fastest_lap_window() -> tuple[int, int] | None:
    """Session-time window of the driver's fastest lap, from the same source the UI uses."""
    load_dotenv("ingest/.env", override=True)
    from ingest.convex_client import ConvexIngestClient

    client = ConvexIngestClient()
    laps = client.query(
        "sessions:listLaps", {"sessionId": SESSION_ID, "driverNumber": DRIVER}
    )
    timed = [lap for lap in laps if lap.get("lapTimeMs")]
    if not timed:
        return None
    best = min(timed, key=lambda lap: lap["lapTimeMs"])
    return best["lapStartMs"], best["lapStartMs"] + best["lapTimeMs"]


def unwrap(angles: np.ndarray) -> np.ndarray:
    out = angles.copy()
    delta = np.diff(angles)
    delta = (delta + np.pi) % TWO_PI - np.pi
    np.cumsum(delta, out=out[1:])
    return out


def moving_average(values: np.ndarray, window: int) -> np.ndarray:
    if window <= 1:
        return values
    kernel = np.ones(window) / window
    return np.convolve(values, kernel, mode="same")


def heading_rate(x: np.ndarray, y: np.ndarray, t: np.ndarray, span: int, window: int):
    n = len(x)
    psi = np.empty(n)
    for i in range(n):
        before = max(0, i - span)
        after = min(n - 1, i + span)
        psi[i] = np.arctan2(y[after] - y[before], x[after] - x[before])
    omega = np.gradient(unwrap(psi), t)
    return moving_average(omega, window)


def curvature(x: np.ndarray, y: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    """Signed curvature from the circumradius of points k samples apart."""
    n = len(x)
    index = np.arange(k, n - k)
    ax, ay = x[index - k], y[index - k]
    bx, by = x[index], y[index]
    cx, cy = x[index + k], y[index + k]
    cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    ab = np.hypot(bx - ax, by - ay)
    bc = np.hypot(cx - bx, cy - by)
    ac = np.hypot(cx - ax, cy - ay)
    denom = ab * bc * ac
    kappa = np.zeros(n)
    ok = denom > 0
    kappa[index[ok]] = 2 * cross[ok] / denom[ok]
    return kappa, index


def path_frame_accel(x: np.ndarray, y: np.ndarray, t: np.ndarray, window: int):
    vx = np.gradient(x, t)
    vy = np.gradient(y, t)
    ax = np.gradient(vx, t)
    ay = np.gradient(vy, t)
    speed = np.hypot(vx, vy)
    with np.errstate(invalid="ignore", divide="ignore"):
        tx, ty = vx / speed, vy / speed
    a_lat = moving_average(ax * -ty + ay * tx, window)
    a_lon = moving_average(ax * tx + ay * ty, window)
    return a_lat, a_lon, speed


def lap_channels(
    channels: dict[str, np.ndarray], t0ms: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, str]:
    """The driver's fastest lap as (t, x, y, speed, label), else the whole slice."""
    t = channels["t"] / 1000.0
    x = channels["x"] / 10.0  # decimetres -> metres
    y = channels["y"] / 10.0
    speed = channels["speed"]  # km/h, from the car feed

    window = fastest_lap_window()
    if window:
        start = int(np.searchsorted(channels["t"], window[0] - t0ms))
        end = int(np.searchsorted(channels["t"], window[1] - t0ms))
        end = min(max(end, start + 10), len(t))
        if end > start:
            return (
                t[start:end],
                x[start:end],
                y[start:end],
                speed[start:end],
                "fastest lap",
            )
    return t, x, y, speed, "whole slice"


def report(channels: dict[str, np.ndarray], t0ms: int) -> None:
    t, x, y, speed, label = lap_channels(channels, t0ms)

    n = len(t)
    dt = np.diff(t)
    speed_ms = speed / 3.6

    print(f"== {label}: {n} samples, {t[-1] - t[0]:.2f} s")
    print(f"   dt: median {np.median(dt) * 1000:.0f} ms  min {dt.min() * 1000:.0f}  "
          f"max {dt.max() * 1000:.0f}   -> {1 / np.median(dt):.1f} Hz")
    print(f"   speed {speed.min():.0f}-{speed.max():.0f} km/h, "
          f"path length {np.sum(np.hypot(np.diff(x), np.diff(y))):.0f} m")

    # Is the stored position the raw 0.1 m grid, or interpolated between samples?
    exact = np.mean(np.abs((channels["x"][:n] * 1.0) - np.round(channels["x"][:n] * 1.0)) < 1e-4)
    steps = np.abs(np.diff(x))
    print(f"   x on the 0.1 m grid: {exact * 100:.0f}% of samples "
          f"(measured 51% raw, so 49% interpolated)   smallest step {steps[steps > 0].min() * 1000:.1f} mm")

    print("\n-- curvature vs. stencil width (m^2/m) ----------------------------------")
    print(f"   {'k':>2}  {'mean|k|':>9}  {'p99|k|':>9}  {'max|k|':>9}  {'closure/2pi':>11}  "
          f"{'implied radius @p99':>19}")
    kappas: dict[int, np.ndarray] = {}
    arc = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(x), np.diff(y)))])
    for k in (1, 2, 3, 5, 10, 20):
        kappa, index = curvature(x, y, k)
        closure = abs(np.sum(kappa[index] * np.gradient(arc)[index]))
        kappas[k] = kappa
        radius = 1 / np.percentile(np.abs(kappa[index]), 99)
        print(f"   {k:>2}  {np.mean(np.abs(kappa)):>9.4f}  "
              f"{np.percentile(np.abs(kappa), 99):>9.4f}  {np.abs(kappa).max():>9.4f}  "
              f"{closure / TWO_PI:>11.2f}  {radius:>17.0f} m")

    print("\n-- lateral acceleration: peak in g by method and smoothing --------------")
    print(f"   {'window':>7}  {'A path-frame':>12}  {'B circumradius':>14}  "
          f"{'C heading rate':>14}  {'A-C rms':>8}")
    reference = None
    for smooth_window in (1, 3, 5, 11, 21):
        a_lat, _, _ = path_frame_accel(x, y, t, smooth_window)
        kappa_smooth = moving_average(kappas[3], smooth_window)
        b_lat = speed_ms**2 * kappa_smooth
        omega = heading_rate(x, y, t, 2, smooth_window)
        c_lat = speed_ms * omega
        rms = np.sqrt(np.mean((a_lat - c_lat) ** 2))
        if reference is None:
            reference = a_lat
        print(f"   {smooth_window:>7}  {np.abs(a_lat).max() / G:>11.2f}g  "
              f"{np.abs(b_lat).max() / G:>13.2f}g  {np.abs(c_lat).max() / G:>13.2f}g  "
              f"{rms:>7.2f}")

    print("\n-- signal vs. high-frequency content (window 11, method A) --------------")
    raw_a, _, _ = path_frame_accel(x, y, t, 1)
    smooth_a, _, _ = path_frame_accel(x, y, t, 11)
    residual = raw_a - smooth_a
    print(f"   rms signal {np.sqrt(np.mean(smooth_a**2)):>6.2f} m/s^2   "
          f"rms residual {np.sqrt(np.mean(residual**2)):>6.2f} m/s^2   "
          f"SNR {20 * np.log10(np.sqrt(np.mean(smooth_a**2)) / np.sqrt(np.mean(residual**2))):>5.1f} dB")

    print("\n-- tenths of a second of the trace (window 11) --------------------------")
    mid = n // 2
    print(f"   {'t[s]':>7} {'speed':>7} {'a_lat':>9} {'a_lon':>9}")
    a_lat, a_lon, _ = path_frame_accel(x, y, t, 11)
    for i in range(mid, mid + 10):
        print(f"   {t[i] - t[0]:>7.2f} {speed[i]:>7.0f} {a_lat[i] / G:>8.2f}g "
              f"{a_lon[i] / G:>8.2f}g")


def repair(
    t: np.ndarray,
    x: np.ndarray,
    y: np.ndarray,
    speed: np.ndarray,
    *,
    min_dt: float = 0.04,
    step_m: float = 2.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Deduplicate the jittered time base, then resample the path on a metre grid.

    The merged car+pos time base contains samples 2 ms apart, where the interpolated
    position has barely moved. Differentiating across those gives a velocity that
    alternates between zero and the car's real speed, which is what makes the raw second
    difference explode. A uniform *distance* grid removes the dt jitter and the
    speed-dependent stencil width in one step.
    """
    keep = np.concatenate([[True], np.diff(t) >= min_dt])
    t, x, y, speed = t[keep], x[keep], y[keep], speed[keep]
    # A ramp of 1e-6 m/step keeps the arclength strictly increasing. Without it, held
    # positions make `s` non-monotonic, and `np.interp` then silently returns garbage
    # over exactly those spans.
    s = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(x), np.diff(y)))])
    s = s + np.arange(len(s)) * 1e-6
    grid = np.arange(0.0, s[-1], step_m)
    return (
        np.interp(grid, s, t),
        np.interp(grid, s, x),
        np.interp(grid, s, y),
        np.interp(grid, s, speed) / 3.6,
    )


def report_repaired(channels: dict[str, np.ndarray], t0ms: int) -> None:
    t, x, y, speed, label = lap_channels(channels, t0ms)
    share = np.mean(np.diff(t) < 0.04) * 100

    print(f"\n== repaired pipeline ({label}) " + "-" * 26)
    print(f"   {share:.0f}% of samples were <40 ms apart and are dropped")
    print(f"   {'baseline':>9}  {'peak raw':>9}  {'peak smooth':>12}  "
          f"{'a_lon err':>10}  {'closure/2pi':>11}")

    for baseline_m in (10.0, 15.0, 25.0, 40.0, 60.0):
        tg, xg, yg, vg = repair(t, x, y, speed)
        k = max(1, int(round(baseline_m / 2.0)))
        kappa, index = curvature(xg, yg, k)
        a_lat = vg**2 * kappa
        arc = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(xg), np.diff(yg)))])
        closure = abs(np.sum(kappa[index] * np.gradient(arc)[index])) / TWO_PI

        # The same second derivative, projected on the path: a_lon. The speed channel
        # measures that quantity independently, so its disagreement *is* the error of
        # the second derivative -- and lateral acceleration is built from it too.
        vx, vy = np.gradient(xg, tg), np.gradient(yg, tg)
        ax, ay = np.gradient(vx, tg), np.gradient(vy, tg)
        path_speed = np.hypot(vx, vy)
        a_lon_path = (ax * vx + ay * vy) / path_speed
        a_lon_speed = np.gradient(vg, tg)
        error = np.sqrt(np.mean((a_lon_path - a_lon_speed) ** 2)) / G

        smooth = moving_average(a_lat, 5)  # 5 grid cells = 10 m
        print(f"   {baseline_m:>7.0f} m  {np.abs(a_lat).max() / G:>8.2f}g  "
              f"{np.abs(smooth).max() / G:>11.2f}g  {error:>9.2f}g  {closure:>11.2f}")


def report_position_rate(
    t: np.ndarray, x: np.ndarray, y: np.ndarray, speed: np.ndarray
) -> None:
    """How much independent information the position channel actually carries."""
    move = np.hypot(np.diff(x), np.diff(y))
    real = move >= 0.05  # at least half a quantisation step
    gaps = np.diff(t)[real]
    print("\n== position stream " + "-" * 44)
    print(f"   samples {len(t)} over {t[-1] - t[0]:.1f} s; "
          f"{np.mean(~real) * 100:.0f}% of steps move < 5 cm")
    print(f"   time between real movements: median {np.median(gaps) * 1000:.0f} ms "
          f"-> {1 / np.median(gaps):.1f} Hz")
    for share in (50, 90, 99):
        print(f"   movement step p{share}: {np.percentile(move, share):.2f} m")

    # The first derivative is the thing every second-order method stands on. If the path
    # does not even agree with the car's own speed channel, curvature is hopeless.
    vx, vy = np.gradient(x, t), np.gradient(y, t)
    path_speed = np.hypot(vx, vy) * 3.6
    ratio = path_speed / speed
    print(f"   path speed: p50 {np.median(path_speed):.0f} km/h "
          f"p99 {np.percentile(path_speed, 99):.0f} km/h "
          f"max {path_speed.max():.0f} km/h   (speed channel max {speed.max():.0f})")
    print(f"   path/channel ratio: p1 {np.percentile(ratio, 1):.2f} "
          f"p50 {np.median(ratio):.2f} p99 {np.percentile(ratio, 99):.2f} "
          f"max {ratio.max():.1f}")
    implied = move / np.diff(t) * 3.6
    print(f"   speed implied by one step: p50 {np.median(implied):.0f} "
          f"p99 {np.percentile(implied, 99):.0f} max {implied.max():.0f} km/h")


def main() -> int:
    channels, t0ms = load_payload()
    lap = lap_channels(channels, t0ms)
    report_position_rate(lap[0], lap[1], lap[2], lap[3])
    report(channels, t0ms)
    report_repaired(channels, t0ms)
    return 0


if __name__ == "__main__":
    sys.exit(main())
