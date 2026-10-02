# Ingest worker

Python worker that pulls Formula 1 sessions with **FastF1** and uploads them to
**Convex** (metadata rows) and to object storage (compressed telemetry files).

Telemetry blobs go to **Cloudflare R2** when `R2_BUCKET` and the credentials are set, and
to Convex file storage otherwise. The Convex free tier is 0.5 GB while a full history is
several gigabytes, so R2 is the backend meant for the archive.

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
| `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Optional: use Cloudflare R2 for telemetry blobs instead of Convex file storage |

## Usage

```bash
# the normal way: serve browser requests
python -m ingest.cli watch                    # dev deployment (ingest/.env)
python -m ingest.cli --prod watch             # production deployment (ingest/.env.prod)

python -m ingest.cli ingest --year 2025 --gp British --session R   # one session
python -m ingest.cli weekend --year 2025 --gp British              # whole weekend
python -m ingest.cli by-session --session-key <convex id>          # one session by id
python -m ingest.cli run-due                                       # sessions Convex considers due
python -m ingest.cli corners --from-year 2025 --to-year 2025       # corner database
python -m ingest.cli calendar --from-year 1950                     # season/event calendar
python -m ingest.cli backfill --from-year 2018 --to-year 2025      # history
```

Flags: `--no-telemetry` (timing only), `--dry-run` (print metadata, upload nothing).

Every operation is idempotent: re-ingesting a session replaces its rows and
telemetry files instead of duplicating them.

## Telemetry format

One file per driver-session, `msgpack + gzip`, columnar **little-endian float32**
channels in this order:

`t` (ms relative to the session slice start), `dist` (m), `speed` (km/h), `rpm`,
`gear`, `thr` (0–100 %), `brk` (0/100), `drs` (0–14), `x`, `y`, `z` (1/10 m), plus
`ahead` (metres to the car ahead, NaN while leading) and `rel` (lap progress 0–1) when the
feed carries them. The payload advertises exactly the channels it holds, so the client
drops a lane it cannot fill instead of drawing zeros.

The web client decodes with `fflate.gunzipSync` + `@msgpack/msgpack` and slices
laps client-side using the lap session times stored in Convex.

## Rate limits

FastF1 enforces conservative limits on the official feed (≈4 requests/second soft,
500 requests/hour hard) and each session takes roughly 40–60 requests, so expect
around ten sessions per hour. Keep the FastF1 cache enabled between runs: the CLI prunes
it after each ingest because a season of cached sessions is several gigabytes, but a warm
cache still avoids re-downloading what is already there.

## ⋎ Where can this run?

The F1 livetiming feed **blocks many cloud/datacenter IP ranges**. A GitHub-hosted
runner gets *empty* session data instead of an error (FastF1 logs "Failed to load
timing data", "Car telemetry data is unavailable"), while the Ergast-style results
still succeed — so a run can look green while storing nothing.

Because of that, the worker refuses to mark a session complete when laps are empty
but ``F1ApiSupport`` says timing should exist; the session is marked ``failed`` with
an explanatory ``lastError`` instead.

Run ingestion from **your own machine on a residential connection**:

```bash
python -u -m ingest.cli watch --interval 10          # dev deployment
python -u -m ingest.cli --prod watch --interval 10   # production deployment
```

`watch` is the only mode that serves the web UI: it polls for request flags, ingests what
it finds and reports a heartbeat. `run-due` processes sessions Convex considers due
(ended 45 min–8 h ago) and does not serve browser requests.

There is **no working CI path**. `.github/workflows/` still contains two workflows that run
`run-due` on GitHub-hosted runners, but they cannot ingest anything — dead weight kept for
reference. No self-hosted runner is configured.

The watcher reports a digest of its own source in the heartbeat. A running Python process
keeps its modules in memory, so editing this directory does not reach it; when the files
change, the heartbeat carries `codeStale` and the web UI warns you to restart the worker.
