"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { CompareCharts } from "@/components/compare-charts";
import { Skeleton, SkeletonChart, SkeletonPills } from "@/components/skeleton";
import { formatLapTime } from "@/lib/telemetry";

type LapRow = {
  lapNumber: number;
  lapStartMs: number | null;
  lapTimeMs: number | null;
  isAccurate?: boolean | null;
  pitIn?: boolean | null;
  pitOut?: boolean | null;
};

/** Fastest accurate, non-pit lap — the sensible default to compare. */
function fastestLap(laps: LapRow[] | undefined): LapRow | null {
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
}

function parseNumber(value: string | null): number | null {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function ComparePage() {
  const params = useParams<{ sessionId: string }>();
  const search = useSearchParams();
  const sessionId = params.sessionId as Id<"sessions">;

  const bundle = useQuery(api.sessions.getSession, { sessionId });
  const results = useQuery(api.sessions.listResults, { sessionId });
  const telemetryFiles = useQuery(api.telemetry.listTelemetryFiles, { sessionId });

  // only drivers we actually hold telemetry for can be compared
  const drivers = useMemo(
    () =>
      (results ?? []).filter((row) =>
        (telemetryFiles ?? []).some((file) => file.driverNumber === row.driverNumber),
      ),
    [results, telemetryFiles],
  );

  const [aDriver, setADriver] = useState<string | null>(search.get("aDriver"));
  const [aLap, setALap] = useState<number | null>(parseNumber(search.get("aLap")));
  const [bDriver, setBDriver] = useState<string | null>(search.get("bDriver"));
  const [bLap, setBLap] = useState<number | null>(parseNumber(search.get("bLap")));

  const driverA = aDriver ?? drivers[0]?.driverNumber ?? null;
  const driverB = bDriver ?? drivers[1]?.driverNumber ?? null;

  const lapsA = useQuery(
    api.sessions.listLaps,
    driverA ? { sessionId, driverNumber: driverA } : "skip",
  );
  const lapsB = useQuery(
    api.sessions.listLaps,
    driverB ? { sessionId, driverNumber: driverB } : "skip",
  );

  const lapA = useMemo(
    () => (lapsA ?? []).find((lap) => lap.lapNumber === aLap) ?? fastestLap(lapsA),
    [lapsA, aLap],
  );
  const lapB = useMemo(
    () => (lapsB ?? []).find((lap) => lap.lapNumber === bLap) ?? fastestLap(lapsB),
    [lapsB, bLap],
  );

  const urlA = (telemetryFiles ?? []).find((file) => file.driverNumber === driverA)?.url;
  const urlB = (telemetryFiles ?? []).find((file) => file.driverNumber === driverB)?.url;

  const labelA = drivers.find((row) => row.driverNumber === driverA)?.code ?? "A";
  const labelB = drivers.find((row) => row.driverNumber === driverB)?.code ?? "B";

  const ready = Boolean(urlA && urlB && lapA && lapB && driverA && driverB && driverA !== driverB);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <Link
        href={`/sessions/${sessionId}`}
        className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted transition-colors hover:text-accent-700"
      >
        ← {bundle?.session.name ?? "Session"}
      </Link>

      <header className="mt-4">
        {bundle === undefined ? (
          <Skeleton className="h-9 w-64" />
        ) : (
          <>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
              {bundle?.year ?? ""} · {bundle?.event?.name ?? ""} · {bundle?.session.name ?? ""}
            </p>
            <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
              Compare laps
            </h1>
          </>
        )}
      </header>

      {results === undefined || telemetryFiles === undefined ? (
        <div className="mt-10 space-y-6">
          <SkeletonPills count={12} width="w-24" />
          <SkeletonChart />
        </div>
      ) : drivers.length < 2 ? (
        <p className="mt-10 text-sm text-muted">
          At least two drivers with telemetry are needed to compare. Load another driver’s
          telemetry from the session page first.
        </p>
      ) : (
        <>
          <section className="mt-10 space-y-8">
            {(
              [
                { title: "Lap A", driver: driverA, setDriver: setADriver, lap: lapA, setLap: setALap, laps: lapsA },
                { title: "Lap B", driver: driverB, setDriver: setBDriver, lap: lapB, setLap: setBLap, laps: lapsB },
              ] as const
            ).map((side) => (
              <div key={side.title}>
                <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
                  {side.title}
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {drivers.map((row) => {
                    const active = row.driverNumber === side.driver;
                    return (
                      <button
                        key={row.driverNumber}
                        type="button"
                        onClick={() => {
                          side.setDriver(row.driverNumber);
                          side.setLap(null);
                        }}
                        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
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
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {side.laps === undefined ? (
                    <SkeletonPills count={10} width="w-20" />
                  ) : (
                    (side.laps as LapRow[]).map((lap) => {
                      const active = side.lap?.lapNumber === lap.lapNumber;
                      const slow = lap.isAccurate === false || lap.pitIn || lap.pitOut;
                      return (
                        <button
                          key={lap.lapNumber}
                          type="button"
                          onClick={() => side.setLap(lap.lapNumber)}
                          className={`rounded-lg border px-2.5 py-1 font-mono text-xs transition-colors ${
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
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          </section>

          <section className="mt-12">
            {ready && urlA && urlB && lapA && lapB ? (
              <CompareCharts
                a={{ url: urlA, lap: lapA, label: labelA }}
                b={{ url: urlB, lap: lapB, label: labelB }}
                corners={bundle?.event?.corners ?? null}
              />
            ) : (
              <p className="text-sm text-muted">
                Pick two different drivers with a timed lap to see the comparison.
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
