"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { WorkbenchChart, type WorkbenchLap } from "@/components/workbench-chart";
import {
  Skeleton,
  SkeletonChart,
  SkeletonPills,
  SkeletonTable,
} from "@/components/skeleton";
import { formatLapTime } from "@/lib/telemetry";

const statusStyles: Record<string, string> = {
  complete: "bg-accent-100 text-accent-800",
  ingesting: "bg-accent-50 text-accent-700",
  requested: "bg-tile-lilac text-accent-800",
  dispatched: "bg-accent-50 text-accent-700",
  pending: "bg-tile-sand text-muted",
  failed: "bg-tile-lilac text-danger",
  skipped: "bg-tile-sand text-muted",
};

export default function SessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId as Id<"sessions">;

  const bundle = useQuery(api.sessions.getSession, { sessionId });
  const results = useQuery(api.sessions.listResults, { sessionId });
  const telemetryFiles = useQuery(api.telemetry.listTelemetryFiles, { sessionId });
  const requestIngest = useMutation(api.sessions.requestIngest);
  const cancelRequest = useMutation(api.sessions.cancelIngestRequest);
  const worker = useQuery(api.worker.status);

  const [driverNumber, setDriverNumber] = useState<string | null>(null);
  const [lapNumber, setLapNumber] = useState<number | null>(null);
  const [requestPending, setRequestPending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const ingestStatus = bundle?.session.ingestStatus ?? null;
  const loaded = ingestStatus === "complete";
  const waiting = ingestStatus === "requested";
  const ingesting = ingestStatus === "ingesting";
  const canRequest = !loaded && !waiting && !ingesting;

  // A worker checks in every few seconds; a stale heartbeat means nobody is listening
  // to this deployment, so a request would otherwise wait forever.
  const workerAgeMs = worker ? Date.now() - worker.lastSeenMs : null;
  const workerOnline = workerAgeMs !== null && workerAgeMs < 45_000;
  const requestedAgeMs = bundle?.session.requestedAtMs
    ? Date.now() - bundle.session.requestedAtMs
    : null;
  const requestStale =
    waiting && requestedAgeMs !== null && requestedAgeMs > 45_000;

  const handleRequest = async () => {
    setRequestPending(true);
    setRequestError(null);
    try {
      await requestIngest({ sessionId });
    } catch (cause) {
      setRequestError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRequestPending(false);
    }
  };

  const handleCancel = async () => {
    setRequestPending(true);
    setRequestError(null);
    try {
      await cancelRequest({ sessionId });
    } catch (cause) {
      setRequestError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRequestPending(false);
    }
  };

  const driversWithTelemetry = useMemo(
    () => new Set((telemetryFiles ?? []).map((file) => file.driverNumber)),
    [telemetryFiles],
  );

  const orderedDrivers = useMemo(() => {
    if (!results) return [];
    const withTelemetry = results.filter((row) =>
      driversWithTelemetry.has(row.driverNumber),
    );
    return withTelemetry.length > 0 ? withTelemetry : results;
  }, [results, driversWithTelemetry]);

  const activeDriver =
    driverNumber ?? orderedDrivers[0]?.driverNumber ?? null;
  const activeTelemetry = (telemetryFiles ?? []).find(
    (file) => file.driverNumber === activeDriver,
  );

  const laps = useQuery(
    api.sessions.listLaps,
    activeDriver ? { sessionId, driverNumber: activeDriver } : "skip",
  );

  /** Fastest accurate, non-pit lap — a sensible default to open on. */
  const bestLap = useMemo(() => {
    if (!laps || laps.length === 0) return null;
    const timed = laps.filter((lap) => lap.lapTimeMs !== null);
    if (timed.length === 0) return null;
    const quick = timed.filter(
      (lap) => lap.isAccurate !== false && !lap.pitIn && !lap.pitOut,
    );
    const pool = quick.length > 0 ? quick : timed;
    return pool.reduce((best, lap) =>
      (lap.lapTimeMs ?? Infinity) < (best.lapTimeMs ?? Infinity) ? lap : best,
    );
  }, [laps]);

  const selectedLap: WorkbenchLap | null = useMemo(() => {
    if (!laps || laps.length === 0) return null;
    const chosen = laps.find((lap) => lap.lapNumber === lapNumber) ?? bestLap;
    if (!chosen) return null;
    return {
      lapNumber: chosen.lapNumber,
      lapStartMs: chosen.lapStartMs ?? null,
      lapTimeMs: chosen.lapTimeMs ?? null,
    };
  }, [laps, lapNumber, bestLap]);

  const fastestLapNumber = bestLap?.lapNumber ?? null;

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6">
      <Link
        href={bundle?.year ? `/seasons/${bundle.year}` : "/seasons"}
        className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted transition-colors hover:text-accent-700"
      >
        ← seasons
      </Link>

      <header className="mt-4">
        {bundle === undefined ? (
          <Skeleton className="h-4 w-64" />
        ) : bundle === null ? (
          <h1 className="font-mono text-sm font-medium">session not found</h1>
        ) : (
          <h1 className="font-mono text-sm font-medium tracking-tight">
            {bundle.year ?? ""} · R{Math.round(bundle.event?.round ?? 0)} ·{" "}
            {bundle.event?.name} · {bundle.session.name}
          </h1>
        )}
        {bundle && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line pb-2">
            <span
              className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-widest ${
                statusStyles[ingestStatus ?? "pending"] ?? "bg-tile-sand text-muted"
              }`}
            >
              {ingestStatus}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-widest text-muted">
              {telemetryFiles === undefined
                ? "telemetry …"
                : bundle.session.telemetryAvailability === "none"
                  ? "no car telemetry in the feed"
                  : `telemetry ${telemetryFiles.length}/${results?.length ?? "?"} drivers`}
            </span>
            {!loaded && (
              <button
                type="button"
                onClick={handleRequest}
                disabled={!canRequest || requestPending}
                className="rounded-full border border-accent-600 px-4 py-1.5 text-xs font-medium text-accent-700 transition-colors hover:bg-accent-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {waiting
                  ? workerOnline
                    ? "Waiting for the worker…"
                    : "Waiting — no worker running"
                  : ingesting
                    ? "Fetching telemetry…"
                    : requestPending
                      ? "Requesting…"
                      : "Load telemetry"}
              </button>
            )}
            {waiting && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={requestPending}
                className="rounded-full px-3 py-1.5 text-xs font-medium text-muted underline-offset-4 transition-colors hover:text-accent-700 hover:underline disabled:opacity-50"
              >
                Cancel request
              </button>
            )}
          </div>
        )}
        {bundle?.session.lastError && (
          <p className="mt-2 font-mono text-[11px] text-danger">
            {bundle.session.lastError}
          </p>
        )}
        {requestError && (
          <p className="mt-2 font-mono text-[11px] text-danger">{requestError}</p>
        )}
        {waiting && (
          <p
            className={`mt-2 max-w-xl text-xs leading-relaxed ${
              workerOnline ? "text-muted" : "text-warning"
            }`}
          >
            {workerOnline
              ? `A worker is watching this deployment (checked in ${Math.max(
                  1,
                  Math.round((workerAgeMs ?? 0) / 1000),
                )}s ago). Fetching a session usually takes under a minute.`
              : requestStale
                ? "No worker is watching this deployment, so this request will not be picked up. Start one with python -m ingest.cli watch — add --prod if this is the deployed site — or cancel the request."
                : "Waiting for a worker to check in… if none is running, start one with python -m ingest.cli watch (--prod for the deployed site)."}
          </p>
        )}
        {bundle && !loaded && (
          <p className="mt-3 max-w-xl text-xs leading-relaxed text-muted">
            Telemetry isn’t stored for this session yet — it is fetched on demand by the
            ingest worker running on your machine (
            <code className="font-mono">python -m ingest.cli watch</code>). Clicking the
            button flags the session; the worker picks it up within seconds and the
            charts appear here automatically.
          </p>
        )}
        {bundle && loaded && bundle.session.telemetryAvailability === "none" && (
          <p className="mt-3 max-w-xl text-xs leading-relaxed text-muted">
            The F1 feed carries no car telemetry for this session (common for 2018–2019).
            Lap times, results and stints are stored in full.
          </p>
        )}
      </header>

      <div className="mt-4 space-y-1.5">
        <div className="flex items-stretch border border-line bg-paper">
          <span className="w-14 shrink-0 border-r border-line px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
            driver
          </span>
          <div className="flex flex-wrap gap-1 p-1">
            {results === undefined ? (
              <SkeletonPills count={8} width="w-16" />
            ) : (
              orderedDrivers.map((row) => {
                const active = row.driverNumber === activeDriver;
                const missing = !driversWithTelemetry.has(row.driverNumber);
                return (
                  <button
                    key={row.driverNumber}
                    type="button"
                    onClick={() => {
                      setDriverNumber(row.driverNumber);
                      setLapNumber(null);
                    }}
                    title={missing ? "No telemetry stored for this driver" : row.fullName}
                    className={`flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                      active
                        ? "border-accent-600 bg-accent-600 text-white"
                        : "border-line hover:border-accent-300"
                    }`}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: row.teamColor ?? "#c2410c" }}
                    />
                    <span className="tabular-nums opacity-60">
                      {row.position ? Math.round(row.position) : "—"}
                    </span>
                    <span className="font-medium">{row.code || row.driverNumber}</span>
                    {missing && (
                      <span className={active ? "text-white/70" : "text-warning"}>!</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="flex items-stretch border border-line bg-paper">
          <span className="w-14 shrink-0 border-r border-line px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
            lap
          </span>
          <div className="flex flex-wrap gap-1 p-1">
            {laps === undefined ? (
              <SkeletonPills count={10} width="w-14" />
            ) : (
              laps.map((lap) => {
                const active = selectedLap?.lapNumber === lap.lapNumber;
                const flag =
                  lap.isAccurate === false
                    ? "inaccurate"
                    : lap.pitIn
                      ? "pit in"
                      : lap.pitOut
                        ? "pit out"
                        : null;
                return (
                  <button
                    key={lap.lapNumber}
                    type="button"
                    onClick={() => setLapNumber(lap.lapNumber)}
                    className={`flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                      active
                        ? "border-accent-600 bg-accent-600 text-white"
                        : "border-line hover:border-accent-300"
                    }`}
                  >
                    <span className="tabular-nums">{lap.lapNumber}</span>
                    <span className="tabular-nums opacity-70">
                      {formatLapTime(lap.lapTimeMs)}
                    </span>
                    <span
                      className={`text-[9px] ${active ? "text-white/70" : "text-muted"}`}
                    >
                      {lap.lapNumber === fastestLapNumber
                        ? "fast"
                        : (flag ?? lap.compound?.[0] ?? "")}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          {activeDriver && selectedLap && (
            <Link
              href={`/sessions/${sessionId}/compare?aDriver=${activeDriver}&aLap=${selectedLap.lapNumber}`}
              className="shrink-0 self-center px-3 font-mono text-[10px] uppercase tracking-[0.16em] text-accent-700 transition-colors hover:text-accent-900"
            >
              compare →
            </Link>
          )}
        </div>
      </div>

      <section className="mt-4 min-w-0 border border-line bg-paper">
        {telemetryFiles === undefined ? (
          <div className="p-4">
            <SkeletonChart height={520} />
          </div>
        ) : activeTelemetry?.url ? (
          <WorkbenchChart url={activeTelemetry.url} lap={selectedLap} />
        ) : (
          <div className="p-6">
            <p className="font-mono text-[11px] text-muted">
              {loaded
                ? bundle?.session.telemetryAvailability === "none"
                  ? "the F1 feed has no car telemetry for this session"
                  : "no telemetry stored for this driver"
                : "telemetry has not been fetched for this session yet"}
            </p>
            {!loaded && (
              <p className="mt-2 max-w-xl font-mono text-[10px] leading-relaxed text-muted">
                telemetry is fetched on demand by the ingest worker on your machine
                (python -m ingest.cli watch). “load telemetry” above flags the session;
                the worker picks it up within seconds and this view fills in by itself.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
          classification
        </h2>
        {results === undefined && <SkeletonTable rows={6} className="mt-2" />}
        {results !== undefined && (
          <div className="mt-2 overflow-x-auto border border-line bg-paper">
            <table className="w-full border-collapse font-mono text-[11px] tabular-nums">
              <thead>
                <tr className="border-b border-line text-left text-[9px] uppercase tracking-[0.14em] text-muted">
                  <th className="px-3 py-1.5 text-right font-normal">pos</th>
                  <th className="px-3 py-1.5 font-normal">#</th>
                  <th className="px-3 py-1.5 font-normal">driver</th>
                  <th className="px-3 py-1.5 font-normal">team</th>
                  <th className="px-3 py-1.5 text-right font-normal">time / status</th>
                  <th className="px-3 py-1.5 text-right font-normal">laps</th>
                  <th className="px-3 py-1.5 text-right font-normal">tel</th>
                </tr>
              </thead>
              <tbody>
                {(results ?? []).map((row) => (
                  <tr key={row.driverNumber} className="border-b border-line/60">
                    <td className="px-3 py-1 text-right">
                      {row.position ? Math.round(row.position) : "—"}
                    </td>
                    <td className="px-3 py-1 text-muted">{row.driverNumber}</td>
                    <td className="px-3 py-1">
                      <span
                        className="mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle"
                        style={{ backgroundColor: row.teamColor ?? "#c2410c" }}
                      />
                      {row.fullName}
                    </td>
                    <td className="px-3 py-1 text-muted">{row.teamName}</td>
                    <td className="px-3 py-1 text-right">
                      {row.timeMs !== null
                        ? formatLapTime(row.timeMs)
                        : (row.status ?? "—")}
                    </td>
                    <td className="px-3 py-1 text-right text-muted">
                      {row.laps ? Math.round(row.laps) : "—"}
                    </td>
                    <td className="px-3 py-1 text-right">
                      <span
                        className={
                          driversWithTelemetry.has(row.driverNumber)
                            ? "text-success"
                            : "text-muted"
                        }
                      >
                        {driversWithTelemetry.has(row.driverNumber) ? "yes" : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
