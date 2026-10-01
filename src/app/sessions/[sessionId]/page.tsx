"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { TelemetryChart, type ChartLap } from "@/components/telemetry-chart";
import { formatLapTime } from "@/lib/telemetry";

export default function SessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId as Id<"sessions">;

  const bundle = useQuery(api.sessions.getSession, { sessionId });
  const results = useQuery(api.sessions.listResults, { sessionId });
  const telemetryFiles = useQuery(api.telemetry.listTelemetryFiles, { sessionId });

  const [driverNumber, setDriverNumber] = useState<string | null>(null);
  const [lapNumber, setLapNumber] = useState<number | null>(null);

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

  const selectedLap: ChartLap | null = useMemo(() => {
    if (!laps || laps.length === 0) return null;
    const chosen = laps.find((lap) => lap.lapNumber === lapNumber) ?? bestLap;
    if (!chosen) return null;
    return {
      lapNumber: chosen.lapNumber,
      lapStartMs: chosen.lapStartMs ?? null,
      lapTimeMs: chosen.lapTimeMs ?? null,
    };
  }, [laps, lapNumber, bestLap]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <Link
        href={bundle?.year ? `/seasons/${bundle.year}` : "/seasons"}
        className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted transition-colors hover:text-accent-700"
      >
        ← {bundle?.event?.name ?? "Seasons"}
      </Link>

      <header className="mt-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
          {bundle?.year ?? ""} · Round {bundle ? Math.round(bundle.event?.round ?? 0) : ""}
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
          {bundle?.session.name ?? "Session"}
        </h1>
        {bundle && (
          <p className="mt-2 font-mono text-xs text-muted">
            {bundle.session.ingestStatus} · telemetry {bundle.session.telemetryAvailability}
          </p>
        )}
      </header>

      <section className="mt-10">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
          Driver
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {orderedDrivers.map((row) => {
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
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors ${
                  active
                    ? "border-accent-600 bg-accent-600 text-white"
                    : "border-line bg-paper hover:border-accent-300"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: row.teamColor ?? "#c2410c" }}
                />
                <span className="font-medium">{row.code || row.driverNumber}</span>
                <span
                  className={`font-mono text-[10px] ${
                    active ? "text-white/70" : "text-muted"
                  }`}
                >
                  {row.position ? `P${Math.round(row.position)}` : "—"}
                </span>
                {missing && (
                  <span
                    className={`font-mono text-[10px] ${
                      active ? "text-white/70" : "text-warning"
                    }`}
                  >
                    no data
                  </span>
                )}
              </button>
            );
          })}
          {results === undefined && (
            <p className="py-2 text-sm text-muted">Loading drivers…</p>
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
          Lap
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {(laps ?? []).map((lap) => {
            const active = selectedLap?.lapNumber === lap.lapNumber;
            const slow = lap.isAccurate === false || lap.pitIn || lap.pitOut;
            return (
              <button
                key={lap.lapNumber}
                type="button"
                onClick={() => setLapNumber(lap.lapNumber)}
                className={`rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors ${
                  active
                    ? "border-accent-600 bg-accent-600 text-white"
                    : slow
                      ? "border-line bg-tile-sand text-muted"
                      : "border-line bg-paper hover:border-accent-300"
                }`}
              >
                <span className="font-medium">{lap.lapNumber}</span>{" "}
                <span className={active ? "text-white/80" : "text-muted"}>
                  {formatLapTime(lap.lapTimeMs)}
                </span>
                {lap.compound && (
                  <span className={active ? "text-white/70" : "text-muted"}>
                    {" "}
                    · {lap.compound[0]}
                  </span>
                )}
              </button>
            );
          })}
          {laps === undefined && activeDriver && (
            <p className="py-2 text-sm text-muted">Loading laps…</p>
          )}
        </div>
      </section>

      <section className="mt-10 rounded-card border border-line bg-paper p-4">
        {activeTelemetry?.url ? (
          <TelemetryChart url={activeTelemetry.url} lap={selectedLap} />
        ) : (
          <p className="py-6 text-sm text-muted">
            {telemetryFiles === undefined
              ? "Loading telemetry…"
              : "No telemetry stored for this driver."}
          </p>
        )}
        <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-muted">
          Speed (km/h, left) · throttle + brake (%, right) · distance axis
        </p>
      </section>

      <section className="mt-12">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
          Classification
        </h2>
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-widest text-muted">
              <th className="py-2 pr-3 font-normal">Pos</th>
              <th className="py-2 pr-3 font-normal">Driver</th>
              <th className="py-2 pr-3 font-normal">Team</th>
              <th className="py-2 pr-3 font-normal">Time / status</th>
              <th className="py-2 font-normal">Laps</th>
            </tr>
          </thead>
          <tbody>
            {(results ?? []).map((row) => (
              <tr key={row.driverNumber} className="border-b border-line/70">
                <td className="py-2 pr-3 font-mono tabular-nums">
                  {row.position ? Math.round(row.position) : "—"}
                </td>
                <td className="py-2 pr-3">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ backgroundColor: row.teamColor ?? "#c2410c" }}
                  />
                  {row.fullName}
                </td>
                <td className="py-2 pr-3 text-muted">{row.teamName}</td>
                <td className="py-2 pr-3 font-mono tabular-nums">
                  {row.timeMs !== null
                    ? formatLapTime(row.timeMs)
                    : (row.status ?? "—")}
                </td>
                <td className="py-2 font-mono tabular-nums text-muted">
                  {row.laps ? Math.round(row.laps) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
