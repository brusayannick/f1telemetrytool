"use client";

import { useMemo, useState } from "react";

/**
 * A lap as the sector table needs it: the three official sector durations plus the flags.
 *
 * These durations have been in the database since the first ingest — `ingest/normalize.py`
 * writes `Sector1Time`/`Sector2Time`/`Sector3Time` into `s1Ms`/`s2Ms`/`s3Ms` and
 * `convex/ingest.ts` validates them — but until now nothing in the repository ever read
 * them (B19). No telemetry is involved: the timing feed already answered the question.
 */
export type SectorLap = {
  lapNumber: number;
  lapTimeMs?: number | null;
  s1Ms?: number | null;
  s2Ms?: number | null;
  s3Ms?: number | null;
  isAccurate?: boolean | null;
  pitIn?: boolean | null;
  pitOut?: boolean | null;
  trackStatus?: string | null;
};

type Props = {
  laps: SectorLap[];
  onPickLap?: (lapNumber: number) => void;
};

type Row = {
  sector: "S1" | "S2" | "S3";
  n: number;
  q1: number;
  median: number;
  q3: number;
  min: number;
  max: number;
  slowest: { lapNumber: number; value: number } | null;
};

/** Linear-interpolated quantile over an ascending array. */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (pos - low);
}

const sec = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/**
 * F21 — lap-time spread per sector.
 *
 * Quartiles of each official sector duration over the laps that are allowed to count. The
 * point is to see *where* a driver's time is unstable: a tight S1 with a wide S3 says the
 * loss lives in the last third of the track, which is a different debrief than "the lap
 * was 0.4 s off".
 *
 * Two honesty rules from the plan, both about not overstating the sample:
 *
 * - **Invalid laps are excluded and counted.** A lap in the pits or the wall would widen
 *   every quartile and make a consistent driver look erratic. The number excluded is shown,
 *   never silently absorbed.
 * - **The traffic filter is not applied here, and the table says so.** Traffic needs the
 *   `ahead` channel out of the telemetry file; this table reads only timing rows and
 *   deliberately costs no fetch. Rather than quietly omitting the filter, it is named as
 *   missing.
 */
export function SectorPanel({ laps, onPickLap }: Props) {
  const [showAll, setShowAll] = useState(false);

  const { rows, used, excluded, noTiming } = useMemo(() => {
    const countable = laps.filter((lap) => {
      if (lap.isAccurate === false) return false;
      if (lap.pitIn || lap.pitOut) return false;
      if (lap.lapTimeMs === null || lap.lapTimeMs === undefined) return false;
      // A lap under yellow or a safety car is not a pace lap. This is track status, not
      // traffic — the plan lists them as separate filters.
      if (lap.trackStatus && lap.trackStatus !== "1") return false;
      return true;
    });

    const withTiming = countable.filter(
      (lap) =>
        typeof lap.s1Ms === "number" &&
        typeof lap.s2Ms === "number" &&
        typeof lap.s3Ms === "number",
    );

    const definitions: { sector: Row["sector"]; pick: (lap: SectorLap) => number }[] = [
      { sector: "S1", pick: (lap) => lap.s1Ms ?? NaN },
      { sector: "S2", pick: (lap) => lap.s2Ms ?? NaN },
      { sector: "S3", pick: (lap) => lap.s3Ms ?? NaN },
    ];

    const built: Row[] = definitions.map(({ sector, pick }) => {
      const entries = withTiming
        .map((lap) => ({ lapNumber: lap.lapNumber, value: pick(lap) }))
        .filter((entry) => Number.isFinite(entry.value))
        .sort((a, b) => a.value - b.value);
      const values = entries.map((entry) => entry.value);

      return {
        sector,
        n: values.length,
        q1: quantile(values, 0.25),
        median: quantile(values, 0.5),
        q3: quantile(values, 0.75),
        min: values[0] ?? NaN,
        max: values[values.length - 1] ?? NaN,
        slowest: entries.length > 0 ? entries[entries.length - 1] : null,
      };
    });

    return {
      rows: built,
      used: withTiming.length,
      excluded: laps.length - countable.length,
      noTiming: countable.length - withTiming.length,
    };
  }, [laps]);

  const shown = showAll ? rows : rows.filter((row) => row.n > 0);
  const totalLaps = laps.length;

  return (
    <section className="mt-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
          sector spread
        </h2>
        <span className="font-mono text-[10px] text-muted">
          quartiles of the official sector times · {used} of {totalLaps} laps counted
        </span>
        <span className="font-mono text-[10px] text-muted">
          {excluded} excluded (pit, inaccurate, yellow/SC)
        </span>
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="font-mono text-[10px] text-muted underline decoration-dotted underline-offset-2 hover:text-accent-700"
        >
          {showAll ? "hide empty sectors" : "show empty sectors"}
        </button>
      </header>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[10px] tabular-nums">
          <thead>
            <tr className="text-muted">
              <th className="px-2 py-1 text-left font-normal">sector</th>
              <th className="px-2 py-1 text-right font-normal">n</th>
              <th className="px-2 py-1 text-right font-normal">min</th>
              <th className="px-2 py-1 text-right font-normal">Q1</th>
              <th className="px-2 py-1 text-right font-normal">median</th>
              <th className="px-2 py-1 text-right font-normal">Q3</th>
              <th className="px-2 py-1 text-right font-normal">IQR</th>
              <th className="px-2 py-1 text-right font-normal">span</th>
              <th className="px-2 py-1 text-left font-normal">slowest</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.sector} className="border-t border-line/50">
                <th scope="row" className="px-2 py-0.5 text-left font-normal text-ink">
                  {row.sector}
                </th>
                <td className="px-2 py-0.5 text-right text-muted">{row.n}</td>
                <td className="px-2 py-0.5 text-right">
                  {Number.isFinite(row.min) ? sec.format(row.min / 1000) : "–"}
                </td>
                <td className="px-2 py-0.5 text-right text-muted">
                  {Number.isFinite(row.q1) ? sec.format(row.q1 / 1000) : "–"}
                </td>
                <td className="px-2 py-0.5 text-right">
                  {Number.isFinite(row.median) ? sec.format(row.median / 1000) : "–"}
                </td>
                <td className="px-2 py-0.5 text-right text-muted">
                  {Number.isFinite(row.q3) ? sec.format(row.q3 / 1000) : "–"}
                </td>
                <td className="px-2 py-0.5 text-right">
                  {Number.isFinite(row.q1) && Number.isFinite(row.q3)
                    ? `${((row.q3 - row.q1) / 1000).toFixed(3)} s`
                    : "–"}
                </td>
                <td className="px-2 py-0.5 text-right text-muted">
                  {Number.isFinite(row.min) && Number.isFinite(row.max)
                    ? `${((row.max - row.min) / 1000).toFixed(3)} s`
                    : "–"}
                </td>
                <td className="px-2 py-0.5 text-left">
                  {row.slowest ? (
                    <button
                      type="button"
                      onClick={() => onPickLap?.(row.slowest!.lapNumber)}
                      title={`slowest ${row.sector}: L${row.slowest.lapNumber} · ${sec.format(
                        row.slowest.value / 1000,
                      )} s`}
                      className="text-warning underline decoration-dotted underline-offset-2 hover:text-accent-700"
                    >
                      L{row.slowest.lapNumber}
                    </button>
                  ) : (
                    <span className="text-muted/40">·</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted">
        The IQR is the width of the middle half — one bad lap cannot stretch it the way it
        stretches a span, which is why both are shown.{" "}
        {noTiming > 0
          ? `${noTiming} countable lap${noTiming === 1 ? "" : "s"} carried no complete sector split and ${
              noTiming === 1 ? "is" : "are"
            } in none of these quartiles. `
          : ""}
        <span className="text-warning">
          The traffic filter is not applied to this table.
        </span>{" "}
        Traffic needs the <span className="text-ink">ahead</span> channel from the telemetry
        file, and this table deliberately reads only timing rows so that it costs no fetch.
        A lap spent behind another car will widen these quartiles.
      </p>
    </section>
  );
}
