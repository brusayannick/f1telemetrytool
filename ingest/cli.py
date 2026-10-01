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
import sys
import traceback
from pathlib import Path

from dotenv import load_dotenv

from . import normalize as nz
from .convex_client import ConvexIngestClient, IngestError
from .fastf1_source import init_cache, load_session

load_dotenv(Path(__file__).parent / ".env")


def ingest_one(
    client: ConvexIngestClient,
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
                        storage_id = client.upload_telemetry(data)
                        client.attach_telemetry(
                            session_id,
                            driver_number,
                            storage_id,
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
                print(f"  ! driver {driver_number}: {err}", file=sys.stderr)

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
        int(bundle["year"]),
        int(bundle["event"]["round"]),
        str(bundle["session"]["name"]),
        telemetry=not args.no_telemetry,
    )
    return 0


def cmd_run_due(args: argparse.Namespace) -> int:
    init_cache(args.cache)
    client = ConvexIngestClient()
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


def cmd_backfill(args: argparse.Namespace) -> int:
    import fastf1

    init_cache(args.cache)
    client = ConvexIngestClient()

    failures = 0
    for year in range(args.from_year, args.to_year + 1):
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
                print(f"[{year} r{round_number}] {session_name}")
                try:
                    ingest_one(
                        client,
                        year,
                        round_number,
                        session_name,
                        telemetry=not args.no_telemetry,
                    )
                except Exception as err:  # noqa: BLE001
                    failures += 1
                    print(f"  failed: {err}", file=sys.stderr)
    return 1 if failures else 0


def cmd_weekend(args: argparse.Namespace) -> int:
    """Ingest every session of one event, skipping sessions already complete."""
    import fastf1

    init_cache(args.cache)
    client = ConvexIngestClient()

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
                args.year,
                round_number,
                session_name,
                telemetry=not args.no_telemetry,
            )
        except Exception as err:  # noqa: BLE001 - continue with other sessions
            failures += 1
            print(f"  failed: {err}", file=sys.stderr)
    return 1 if failures else 0


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

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except IngestError as err:
        print(f"ingest error: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
