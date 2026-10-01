# Ingest worker

Python worker that pulls Formula 1 sessions with **FastF1** and uploads them to
**Convex** (metadata rows + compressed telemetry files in file storage).

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r ingest/requirements.txt
cp ingest/.env.example ingest/.env
```

Fill in `ingest/.env`:

| Variable | Where to find it |
| --- | --- |
| `CONVEX_SITE_URL` | Convex dashboard → Deployment settings (HTTP actions URL, `.convex.site`) |
| `INGEST_SECRET` | The value you set with `npx convex env set INGEST_SECRET …` |
| `CONVEX_URL` | Deployment URL (`.convex.cloud`) — only needed for queries |
| `FASTF1_CACHE` | Optional cache directory (defaults to `~/.cache/fastf1`) |

## Usage

```bash
python -m ingest.cli ingest --year 2025 --gp British --session R   # one session
python -m ingest.cli by-session --session-key <convex id>          # used by CI
python -m ingest.cli run-due                                       # due sessions
python -m ingest.cli backfill --from-year 2018 --to-year 2025      # history
```

Flags: `--no-telemetry` (timing only), `--dry-run` (print metadata, upload nothing).

Every operation is idempotent: re-ingesting a session replaces its rows and
telemetry files instead of duplicating them.

## Telemetry format

One file per driver-session, `msgpack + gzip`, columnar **little-endian float32**
channels in this order:

`t` (ms relative to the session slice start), `dist` (m), `speed` (km/h), `rpm`,
`gear`, `thr` (0–100 %), `brk` (0/100), `drs` (0–14), `x`, `y`, `z` (1/10 m).

The web client decodes with `fflate.gunzipSync` + `@msgpack/msgpack` and slices
laps client-side using the lap session times stored in Convex.

## Rate limits

FastF1 enforces conservative limits on the official feed (≈4 requests/second soft,
500 requests/hour hard) and each session takes roughly 40–60 requests, so expect
around ten sessions per hour. Keep the FastF1 cache enabled between runs — CI uses
`$RUNNER_TEMP` and therefore starts cold each time.

## ⋎ Where can this run?

The F1 livetiming feed **blocks many cloud/datacenter IP ranges**. A GitHub-hosted
runner gets *empty* session data instead of an error (FastF1 logs "Failed to load
timing data", "Car telemetry data is unavailable"), while the Ergast-style results
still succeed — so a run can look green while storing nothing.

Because of that, the worker refuses to mark a session complete when laps are empty
but ``F1ApiSupport`` says timing should exist; the session is marked ``failed`` with
an explanatory ``lastError`` instead.

Run ingestion from:

- **your own machine** (residential IP) — `python -m ingest.cli run-due`,
- a **self-hosted GitHub Actions runner** on that machine (keeps the dispatch flow), or
- a host whose IP is not blocked (verify before relying on it).

GitHub-hosted runners remain useful for the *scheduling* half: the Convex cron
dispatches the workflow, and a self-hosted runner executes it.
