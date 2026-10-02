# F1 Telemetry Analysis

A lightweight, modern platform for exploring and comparing Formula 1 car telemetry —
every session from 2018 onwards, distance-aligned lap comparisons, track maps and
automatically detected lap anomalies.

**Stack:** Next.js (Vercel) · Convex (database + file storage) · FastF1 ingestion worker
(**local watcher**, see below) · uPlot charts. Telemetry blobs go to Cloudflare R2 when
`R2_*` is configured, otherwise Convex file storage. Design language: light-first,
Perk-inspired, petrol accent `#005f73`.

> Unofficial project. Not associated with Formula 1. Data via [FastF1](https://github.com/theOehrly/Fast-F1),
> [Jolpica](https://github.com/jolpica/jolpica-f1) and [OpenF1](https://openf1.org).

## Architecture

```mermaid
flowchart LR
  B[Browser] -->|request flag| C[(Convex)]
  W[Python ingest worker\nlocal watcher] -->|polls requests| C
  F1[F1 livetiming feed] -->|FastF1| W
  W -->|HTTP actions /ingest/*| C
  C -->|reactive queries| N[Next.js on Vercel]
  C -->|file storage or R2| T[Telemetry blobs] --> N
```

- **Metadata** (seasons, events, sessions, drivers, laps, stints) lives in Convex tables.
- **Telemetry** is stored per driver-session as gzip-compressed msgpack with columnar
  little-endian float32 channels (`msgpack+gzip/float32le`).
- **Ingestion is on demand.** The browser can only write a request flag; the local watcher
  polls for it, fetches the session from the F1 feed and uploads it. The UI updates
  reactively. Nothing is fetched automatically — see *Running the workers*.

## Quickstart

```bash
# 1. JS dependencies
npm install

# 2. Link a Convex deployment (interactive — creates/logs into your account)
npx convex dev

# 3. Configure ingestion secrets on the Convex deployment
npx convex env set INGEST_SECRET "$(openssl rand -hex 24)"
npx convex env set GH_REPO "<owner>/<repo>"          # optional: JIT dispatch
npx convex env set GH_DISPATCH_TOKEN "<fine-grained PAT, Actions: write>"  # optional

# 4. Python worker
python3 -m venv .venv && source .venv/bin/activate
pip install -r ingest/requirements.txt
cp ingest/.env.example ingest/.env   # then fill in CONVEX_SITE_URL / INGEST_SECRET

# 5. Smoke test one session
python -m ingest.cli ingest --year 2025 --gp British --session R

# 6. Run the app
npm run dev
```

The Convex deployment URL and HTTP-actions URL are printed by `npx convex dev`
(`https://<deployment>.convex.cloud` and `https://<deployment>.convex.site`).

## Ingestion CLI

| Command | Purpose |
| --- | --- |
| `python -m ingest.cli ingest --year 2025 --gp British --session R` | Ingest one session (idempotent) |
| `python -m ingest.cli watch` | **The normal way to run it.** Poll for browser requests and ingest them (`--prod` for the deployed site) |
| `python -m ingest.cli weekend --year 2025 --gp British` | Ingest every session of one event, skipping completed ones |
| `python -m ingest.cli by-session --session-key <convex id>` | Ingest one session by its Convex id |
| `python -m ingest.cli run-due` | Ingest sessions Convex considers due (ended 45 min–8 h ago); no browser requests |
| `python -m ingest.cli corners --from-year 2025 --to-year 2025` | Backfill the curated corner database, one session load per event |
| `python -m ingest.cli calendar --from-year 1950` | Sync the season/event calendar |
| `python -m ingest.cli backfill --from-year 2018 --to-year 2025` | Historical backfill with checkpointing via Convex status checks |

> **Ingest runs from this machine, not from CI.** The F1 livetiming feed blocks
> cloud/datacenter IP ranges, so a GitHub-hosted runner receives *empty* session data
> (results come from a different host and still succeed, which made the failure easy to
> miss). The worker refuses to mark such a session complete and marks it `failed` with an
> explanatory `lastError` instead.
>
> The Convex cron's dispatch is gated behind `GH_DISPATCH_ENABLED` and off by default, but
> `.github/workflows/ingest-cron.yml` still runs `run-due` on a GitHub-hosted runner every
> 30 minutes. That pass cannot ingest anything; treat the workflows as dead weight until
> they are removed.

Add `--no-telemetry` to ingest timing data only, or `--dry-run` to preview metadata.

## Running the workers

Two watchers, one per deployment. Both must run **on a residential connection** — this is
the only place the F1 feed answers.

```bash
# development deployment (ingest/.env)
python -u -m ingest.cli watch --interval 10 >> dev-watcher.log 2>&1 &

# production deployment (ingest/.env.prod)
python -u -m ingest.cli --prod watch --interval 10 >> prod-watcher.log 2>&1 &
```

A worker checks in on every poll, so the UI can tell "the worker is fetching this" from
"no worker is running at all". It also reports a digest of its own source: **a running
Python process keeps its modules in memory**, so editing `ingest/` does not reach it, and
payloads would silently miss newly added channels. When the files change, the heartbeat
carries `codeStale` and the session page warns you to restart the worker.

## Repository layout

```
convex/            schema + ingest mutations, HTTP actions, queries, cron
  schema.ts        tables: seasons, events, sessions, drivers, teams, laps,…
  ingest.ts        internal mutations used by the worker (idempotent upserts)
  http.ts          /ingest/* HTTP actions (shared-secret auth)
  sessions.ts      public queries (listEvents, getSession, listLaps,…)
  schedule.ts      due-session detection + GitHub workflow dispatch (gated, off by default)
  crons.ts         every 10 minutes: check for finished sessions (dispatch is gated off)
  worker.ts        worker heartbeat: liveness, code digest, stale-code flag
ingest/            Python worker (FastF1 → Convex)
  normalize.py     FastF1 objects → Convex payloads + telemetry packing
  convex_client.py HTTP client for the ingest endpoints
  cli.py           ingest / watch / weekend / by-session / run-due / corners / calendar / backfill
.github/workflows/ ingest-session, ingest-cron — both target the blocked CI path; they
                   cannot ingest and are kept only for reference
src/               Next.js app (App Router, Tailwind v4, uPlot)
```

## Roadmap

- [x] Project scaffold, design tokens, Convex schema, ingest worker skeleton
- [ ] Full telemetry workbench (distance-aligned charts, delta trace, track map)
- [ ] Season/event/session browser with ingest status
- [ ] Precomputed anomaly scores (unsupervised) + explanations in the UI
- [ ] 1950–2017 metadata import via Jolpica
- [ ] Optional: live data via OpenF1 (MQTT/WebSocket)

## Notes

- Personal, non-commercial project; keep the unofficial disclaimer visible.
- Telemetry is only available from 2018 onwards; a few 2018–2019 events are partial.
- FastF1 enforces conservative rate limits (≈4 req/s soft, 500 req/h hard) and caching is
  enabled by default — backfills take hours and run in chunks.
