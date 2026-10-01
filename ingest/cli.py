"""CLI entry point for the F1 ingestion worker.

Usage examples (run from the repository root):

    python -m ingest.cli ingest --year 2025 --gp British --session R
    python -m ingest.cli weekend --year 2025 --gp British
    python -m ingest.cli by-session --session-key <convex session id>
    python -m ingest.cli run-due
    python -m ingest.cli backfill --from-year 2018 --to-year 2025
"""

from __future__ import annotations

import argparse
import contextlib
import os
import shutil
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

from . import normalize as nz
from .blob_store import BlobStore, build_blob_store, telemetry_key
from .convex_client import ConvexIngestClient, IngestError
from .fastf1_source import init_cache, load_session

DEFAULT_ENV_FILE = Path(__file__).parent / ".env"


def load_env(explicit: str | None = None) -> None:
    """Load worker configuration.

    Defaults to ``ingest/.env`` (the dev deployment); pass a path to target another
    deployment, e.g. ``ingest/.env.prod`` for the deployment the public site uses.
    Values already present in the environment still win, so exports override the file.
    """
    if explicit:
        load_dotenv(explicit, override=True)
    else:
        load_dotenv(DEFAULT_ENV_FILE)


def ingest_one(
    client: ConvexIngestClient,
    store: BlobStore,
    year: int,
    gp: str | int,
    identifier: str | int,
    *,
    telemetry: bool = True,
    dry_run: bool = False,
) -> None:
    """Fetch one session from F1's feed and upload it to Convex (idempotent)."""
    try:
        session = load_session(year, gp, identifier, telemetry=telemetry)
    except Exception:
        if not telemetry:
            raise
        print("  telemetry load failed, retrying without it", file=sys.stderr)
        session = load_session(year, gp, identifier, telemetry=False)
        telemetry = False

    meta = nz.session_meta(session)
    label = f"{meta['year']} {meta['event']['name']} – {meta['session']['name']}"
    print(f"session loaded: {label}")

    if dry_run:
        print(f"dry run: {meta}")
        return

    season_id = client.upsert_season(meta["year"])
    event_id = client.upsert_event(season_id, meta["event"])
    session_id = client.upsert_session(event_id, meta["session"])
    client.set_session_status(session_id, "ingesting")

    try:
        results = nz.results_rows(session)
        if results:
            client.upsert_results(session_id, results)
            print(f"  results: {len(results)} drivers")

        drivers = nz.driver_numbers(session)
        if not drivers and nz.expects_timing(session):
            raise RuntimeError(
                "The F1 timing feed returned no session data (empty laps and "
                "telemetry). Refusing to store an empty session — this usually "
                "means the feed blocks this network (cloud/datacenter IPs are "
                "commonly blocked, e.g. GitHub Actions). Run the ingest from a "
                "residential connection or a self-hosted runner."
            )

        if telemetry and not nz.has_car_telemetry(session):
            print(
                "  the feed has no car telemetry for this session "
                "(common for 2018–2019) — storing timing data only"
            )
            telemetry = False

        with_file = 0
        failed = 0
        for driver_number in drivers:
            try:
                laps = nz.laps_rows(session, driver_number)
                if laps:
                    client.upsert_laps(session_id, driver_number, laps)
                stints = nz.stints_rows(session, driver_number)
                if stints:
                    client.upsert_stints(session_id, driver_number, stints)

                if telemetry:
                    payload = nz.telemetry_payload(session, driver_number)
                    if payload is not None:
                        data, info = payload
                        reference = store.put(
                            telemetry_key(
                                meta["year"],
                                meta["event"]["round"],
                                meta["session"]["name"],
                                driver_number,
                            ),
                            data,
                        )
                        client.attach_telemetry(
                            session_id,
                            driver_number,
                            reference,
                            format=info["format"],
                            channels=info["channels"],
                            sample_count=info["sampleCount"],
                            bytes=info["bytes"],
                            freq_hz=info["freqHz"],
                        )
                        with_file += 1
                        print(
                            f"  driver {driver_number}: {len(laps)} laps, "
                            f"{info['sampleCount']} samples, {info['bytes'] / 1024:.0f} KiB"
                        )
                    else:
                        print(f"  driver {driver_number}: no telemetry")
                else:
                    print(f"  driver {driver_number}: {len(laps)} laps (no telemetry)")
            except Exception as err:  # noqa: BLE001 - keep going per driver
                failed += 1
                print(
                    f"  ! driver {driver_number}: {type(err).__name__}: {err}",
                    file=sys.stderr,
                )

        if not telemetry:
            availability = "none"
        elif failed == 0 and with_file == len(drivers) and with_file > 0:
            availability = "full"
        elif with_file > 0:
            availability = "partial"
        else:
            availability = "none"

        client.set_session_status(session_id, "complete", telemetry=availability)
        print(f"done: session {session_id} (telemetry: {availability})")
    except Exception as err:  # noqa: BLE001
        client.set_session_status(session_id, "failed", error=str(err)[:500])
        raise


def cmd_ingest(args: argparse.Namespace) -> int:
    init_cache(args.cache)
    client = ConvexIngestClient()
    ingest_one(
        client,
        build_blob_store(client),
        args.year,
        args.gp,
        args.session,
        telemetry=not args.no_telemetry,
        dry_run=args.dry_run,
    )
    return 0


def cmd_by_session(args: argparse.Namespace) -> int:
    init_cache(args.cache)
    client = ConvexIngestClient()
    bundle = client.query("sessions:getSession", {"sessionId": args.session_key})
    if not bundle or not bundle.get("event") or bundle.get("year") is None:
        print(f"session {args.session_key} not found in Convex", file=sys.stderr)
        return 1
    ingest_one(
        client,
        build_blob_store(client),
        int(bundle["year"]),
        int(bundle["event"]["round"]),
        str(bundle["session"]["name"]),
        telemetry=not args.no_telemetry,
    )
    return 0


def cmd_run_due(args: argparse.Namespace) -> int:
    init_cache(args.cache)
    client = ConvexIngestClient()
    store = build_blob_store(client)
    due = client.query("schedule:dueSessions", {})
    if not due:
        print("no due sessions")
        return 0

    failures = 0
    for entry in due:
        if entry.get("year") is None:
            continue
        print(
            f"due: {entry['year']} {entry['eventName']} – {entry['sessionName']}"
        )
        try:
            ingest_one(
                client,
                store,
                int(entry["year"]),
                int(entry["round"]),
                str(entry["sessionName"]),
                telemetry=not args.no_telemetry,
            )
        except (Exception, IngestError) as err:  # noqa: BLE001
            failures += 1
            print(f"  failed: {err}", file=sys.stderr)
            traceback.print_exc(limit=1)
    return 1 if failures else 0


def _prune_cache(cache_dir: str) -> None:
    """Clear the FastF1 cache.

    A season of cached session data is several gigabytes, so a long backfill would
    exhaust the disk. The data is already in Convex by this point; keeping the cache
    only ever saved re-downloads.
    """
    root = Path(cache_dir)
    if not root.exists():
        return
    for entry in root.iterdir():
        if entry.is_dir():
            shutil.rmtree(entry, ignore_errors=True)
        else:
            with contextlib.suppress(OSError):
                entry.unlink()


def cmd_backfill(args: argparse.Namespace) -> int:
    import fastf1

    cache_dir = init_cache(args.cache)
    client = ConvexIngestClient()
    store = build_blob_store(client)

    years = list(range(args.from_year, args.to_year + 1))
    if args.newest_first:
        years.reverse()

    max_bytes = None if args.max_mb is None else int(args.max_mb * 1024 * 1024)

    failures = 0
    ingested = 0
    for year in years:
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        for _, event in schedule.iterrows():
            round_number = int(event["RoundNumber"])
            if round_number == 0:
                continue
            for index in range(1, 6):
                session_name = event.get(f"Session{index}")
                if not isinstance(session_name, str) or not session_name:
                    continue
                status = client.status_for(year, round_number, session_name)
                if status and status.get("ingestStatus") == "complete":
                    continue
                if max_bytes is not None:
                    usage = client.storage_usage()
                    if usage["bytes"] >= max_bytes:
                        print(
                            f"[{datetime.now():%Y-%m-%d %H:%M:%S}] storage guard: "
                            f"{usage['bytes'] / 1024 / 1024:.0f} MiB in {usage['files']} "
                            f"files >= {args.max_mb:.0f} MB — pausing"
                        )
                        print(f"backfill paused: {ingested} ingested, {failures} failed")
                        return 0
                if args.limit is not None and ingested >= args.limit:
                    print(f"limit reached ({ingested} sessions)")
                    return 1 if failures else 0
                print(
                    f"[{datetime.now():%Y-%m-%d %H:%M:%S}] "
                    f"{year} r{round_number} {session_name}"
                )
                try:
                    ingest_one(
                        client,
                        store,
                        year,
                        round_number,
                        session_name,
                        telemetry=not args.no_telemetry,
                    )
                    ingested += 1
                except Exception as err:  # noqa: BLE001
                    failures += 1
                    print(
                        f"[{datetime.now():%Y-%m-%d %H:%M:%S}]   failed: {err}",
                        file=sys.stderr,
                    )
                finally:
                    if args.prune_cache:
                        _prune_cache(cache_dir)
    print(f"backfill finished: {ingested} ingested, {failures} failed")
    return 1 if failures else 0


def cmd_weekend(args: argparse.Namespace) -> int:
    """Ingest every session of one event, skipping sessions already complete."""
    import fastf1

    init_cache(args.cache)
    client = ConvexIngestClient()
    store = build_blob_store(client)

    event = fastf1.get_event(args.year, args.gp)
    round_number = int(event["RoundNumber"])
    print(f"weekend: {args.year} round {round_number} ({event['EventName']})")

    failures = 0
    for index in range(1, 6):
        session_name = event.get(f"Session{index}")
        if not isinstance(session_name, str) or not session_name:
            continue
        status = client.status_for(args.year, round_number, session_name)
        if status and status.get("ingestStatus") == "complete" and not args.force:
            print(f"skip (already complete): {session_name}")
            continue
        print(f"ingesting: {session_name}")
        try:
            ingest_one(
                client,
                store,
                args.year,
                round_number,
                session_name,
                telemetry=not args.no_telemetry,
            )
        except Exception as err:  # noqa: BLE001 - continue with other sessions
            failures += 1
            print(f"  failed: {err}", file=sys.stderr)
    return 1 if failures else 0


def cmd_calendar(args: argparse.Namespace) -> int:
    """Sync season/event/session rows for a year range — no telemetry, no session loads.

    Makes the whole history browsable so sessions can be requested on demand.
    """
    import fastf1

    init_cache(args.cache)
    client = ConvexIngestClient()

    written = 0
    failed = 0
    for year in range(args.from_year, args.to_year + 1):
        # A single slow response must not abandon the remaining seasons.
        try:
            schedule = fastf1.get_event_schedule(year, include_testing=False)
            season_id = client.upsert_season(year)
            for _, event in schedule.iterrows():
                payloads = nz.calendar_payloads(event)
                if payloads is None:
                    continue
                event_payload, sessions = payloads
                if event_payload["round"] == 0:
                    continue
                event_id = client.upsert_event(season_id, event_payload)
                for session in sessions:
                    client.upsert_session(event_id, session)
                    written += 1
            print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {year}: calendar synced")
        except Exception as err:  # noqa: BLE001 - continue with the next season
            failed += 1
            print(
                f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {year} failed: "
                f"{type(err).__name__}: {err}",
                file=sys.stderr,
            )

    print(f"calendar synced: {written} sessions ({failed} years failed)")
    return 1 if failed else 0


def cmd_watch(args: argparse.Namespace) -> int:
    """Poll Convex for telemetry requests from the web UI and ingest them.

    This is the bridge between a click in the browser and the F1 feed: the browser can
    only write a request flag, while the fetch has to happen from a residential IP.
    """
    init_cache(args.cache)
    client = ConvexIngestClient()
    store = build_blob_store(client)
    target = os.environ.get("CONVEX_URL", "unknown")

    print(
        f"[{datetime.now():%Y-%m-%d %H:%M:%S}] watching {target} for requests every "
        f"{args.interval:.0f}s (Ctrl-C to stop)"
    )
    while True:
        # Never let a transient network failure kill the daemon: log it and retry.
        try:
            client.heartbeat(target)
        except Exception as err:  # noqa: BLE001 - a worker must outlive a bad request
            print(
                f"[{datetime.now():%Y-%m-%d %H:%M:%S}] heartbeat failed: "
                f"{type(err).__name__}: {err}",
                file=sys.stderr,
            )

        try:
            requested = client.query("sessions:requestedSessions", {})
        except Exception as err:  # noqa: BLE001 - keep polling
            print(
                f"[{datetime.now():%Y-%m-%d %H:%M:%S}] poll failed: "
                f"{type(err).__name__}: {err}",
                file=sys.stderr,
            )
            requested = []

        for entry in requested:
            if entry.get("year") is None:
                continue
            print(
                f"[{datetime.now():%Y-%m-%d %H:%M:%S}] request: {entry['year']} "
                f"r{entry['round']} {entry['eventName']} – {entry['sessionName']}"
            )
            try:
                ingest_one(
                    client,
                    store,
                    int(entry["year"]),
                    int(entry["round"]),
                    str(entry["sessionName"]),
                )
            except Exception as err:  # noqa: BLE001 - keep watching
                print(
                    f"[{datetime.now():%Y-%m-%d %H:%M:%S}]   failed: {err}",
                    file=sys.stderr,
                )

        time.sleep(args.interval)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ingest", description=__doc__)
    parser.add_argument(
        "--cache",
        default=None,
        help="FastF1 cache directory (default: $FASTF1_CACHE or ~/.cache/fastf1)",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    p_ingest = subparsers.add_parser("ingest", help="Ingest a single session")
    p_ingest.add_argument("--year", type=int, required=True)
    p_ingest.add_argument("--gp", required=True, help="Event name or round number")
    p_ingest.add_argument("--session", required=True, help="R, Q, FP1… or 'Race'")
    p_ingest.add_argument("--no-telemetry", action="store_true")
    p_ingest.add_argument("--dry-run", action="store_true")
    p_ingest.set_defaults(func=cmd_ingest)

    p_session = subparsers.add_parser("by-session", help="Ingest by Convex session id")
    p_session.add_argument("--session-key", required=True)
    p_session.add_argument("--no-telemetry", action="store_true")
    p_session.set_defaults(func=cmd_by_session)

    p_due = subparsers.add_parser("run-due", help="Ingest all due sessions")
    p_due.add_argument("--no-telemetry", action="store_true")
    p_due.set_defaults(func=cmd_run_due)

    p_backfill = subparsers.add_parser("backfill", help="Backfill a year range")
    p_backfill.add_argument("--from-year", type=int, required=True)
    p_backfill.add_argument("--to-year", type=int, required=True)
    p_backfill.add_argument("--no-telemetry", action="store_true")
    p_backfill.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Stop after N sessions (useful for smoke tests)",
    )
    p_backfill.add_argument(
        "--newest-first",
        action="store_true",
        help="Iterate seasons newest first (most relevant data lands first)",
    )
    p_backfill.add_argument(
        "--max-mb",
        type=float,
        default=None,
        help="Pause once Convex telemetry storage exceeds this many MiB",
    )
    p_backfill.add_argument(
        "--prune-cache",
        action="store_true",
        help="Clear the FastF1 cache after each session (bounds disk usage)",
    )
    p_backfill.set_defaults(func=cmd_backfill)

    p_weekend = subparsers.add_parser(
        "weekend", help="Ingest every session of one event (skips completed)"
    )
    p_weekend.add_argument("--year", type=int, required=True)
    p_weekend.add_argument("--gp", required=True, help="Event name or round number")
    p_weekend.add_argument("--no-telemetry", action="store_true")
    p_weekend.add_argument(
        "--force", action="store_true", help="Re-ingest sessions already marked complete"
    )
    p_weekend.set_defaults(func=cmd_weekend)

    p_calendar = subparsers.add_parser(
        "calendar", help="Sync season/event/session rows for a year range (no telemetry)"
    )
    p_calendar.add_argument("--from-year", type=int, required=True)
    p_calendar.add_argument("--to-year", type=int, required=True)
    p_calendar.set_defaults(func=cmd_calendar)

    p_watch = subparsers.add_parser(
        "watch", help="Serve on-demand telemetry requests from the web UI"
    )
    p_watch.add_argument(
        "--interval",
        type=float,
        default=15.0,
        help="Seconds between polls (default: 15)",
    )
    p_watch.set_defaults(func=cmd_watch)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    parser.add_argument(
        "--env-file",
        default=None,
        help="Worker configuration file (default: ingest/.env, e.g. ingest/.env.prod)",
    )
    parser.add_argument(
        "--prod",
        action="store_true",
        help="Shorthand for --env-file ingest/.env.prod (the deployment the public site uses)",
    )
    args = parser.parse_args(argv)
    env_file = args.env_file or (
        str(Path(__file__).parent / ".env.prod") if args.prod else None
    )
    load_env(env_file)
    try:
        return int(args.func(args))
    except IngestError as err:
        print(f"ingest error: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
