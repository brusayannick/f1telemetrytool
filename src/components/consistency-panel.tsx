"use client";

import { useEffect, useMemo, useState } from "react";
import type { Corner } from "@/lib/corners";
import { buildSegments } from "@/lib/segments";
import {
  lapRange,
  lapSeries,
  loadTelemetry,
  type LapInfo,
  type Telemetry,
} from "@/lib/telemetry";

/** The plan's default outlier factor (section 7.2, "Ausreißer-Faktor"). */
const OUTLIER_MAD = 3;

/** The plan's default traffic threshold (section 7.2, "Verkehrsschwelle"). */
const TRAFFIC_GAP_M = 300;

export type ConsistencyLap = LapInfo & {
  lapNumber: number;
  isAccurate?: boolean | null;
  pitIn?: boolean | null;
  pitOut?: boolean | null;
};

type Props = {
  /** One telemetry file — the whole session of this driver. */
  url: string;
  laps: ConsistencyLap[];
  corners?: Corner[] | null;
  onPickLap?: (lapNumber: number) => void;
};

/** Values for one corner across the laps that measured it. */
type CornerStats = {
  label: string;
  nApex: number;
  apexMedian: number;
  apexMad: number;
  apexMin: number;
  apexMax: number;
  apexOutliers: { lapNumber: number; value: number }[];
  nBrake: number;
  brakeMedian: number;
  brakeMin: number;
  brakeMax: number;
  brakeOutliers: { lapNumber: number; value: number }[];
  /** Laps that never braked for this corner, so they cannot inform its braking point. */
  noBrakeLaps: number[];
};

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function madOf(values: number[], centre: number): number {
  return median(values.map((value) => Math.abs(value - centre)));
}

const oneDp = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * F19, F20 and F22 — consistency across the laps of one driver.
 *
 * Reads the same decomposition as the segment matrix, from the same single telemetry
 * request, and asks a different question: not "where did this lap lose time" but "how
 * repeatable is this driver in this corner".
 *
 * The plan's statistics rules are load-bearing here, and each one costs something:
 *
 * - **Median and MAD, never mean and σ.** One lock-up in one lap must not move the
 *   number that is supposed to describe the other nineteen.
 * - **n is always shown.** A median over three laps and a median over nineteen look
 *   identical in a table and mean completely different things.
 * - **Outliers are marked, not removed.** The plan is explicit: a lap outside the rule
 *   stays in the table and is called out, because deleting it would make the driver look
 *   more consistent than the data says.
 * - **A value only counts if its segment really covers its corner.** A corner segment
 *   that swallowed a neighbour, or whose apex sits outside its own range, has an apex
 *   speed that belongs to a different piece of track — those are excluded rather than
 *   averaged in.
 * - **A lap that never braked informs nothing about braking points.** It is counted as
 *   excluded, not as a braking point of zero.
 */
export function ConsistencyPanel({ url, laps, corners = null, onPickLap }: Props) {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setTelemetry(null);
    setFailed(false);
    loadTelemetry(url)
      .then((loaded) => {
        if (!cancelled) setTelemetry(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const stats = useMemo(() => {
    if (!telemetry) {
      return { rows: [] as CornerStats[], counted: 0, trafficSkipped: 0 };
    }

    let counted = 0;
    let trafficSkipped = 0;
    const apexByLabel = new Map<string, { lapNumber: number; value: number }[]>();
    const brakeByLabel = new Map<string, { lapNumber: number; value: number }[]>();
    const noBrakeByLabel = new Map<string, number[]>();
    const order: string[] = [];

    for (const lap of laps) {
      // Only a lap that is allowed to count may set the picture. The traffic filter is part
      // of that — plan §7.2 lists F19 among the features it affects, default on — and it is
      // measured here rather than assumed: the footer used to claim it without checking it.
      if (lap.isAccurate === false || lap.pitIn || lap.pitOut) continue;
      if (lap.lapTimeMs === null || lap.lapStartMs === null) continue;

      const range = lapRange(telemetry, lap);
      const ahead = telemetry.channels.ahead;
      if (range && ahead) {
        let minGap = Infinity;
        for (let i = range[0]; i < range[1]; i += 1) {
          const gap = ahead[i];
          if (Number.isFinite(gap) && gap < minGap) minGap = gap;
        }
        if (minGap < TRAFFIC_GAP_M) {
          trafficSkipped += 1;
          continue;
        }
      }

      const series = lapSeries(telemetry, lap);
      if (!series) continue;
      counted += 1;

      for (const segment of buildSegments(series, corners)) {
        if (segment.kind !== "corner") continue;

        // A segment that contains a neighbour, or whose apex is not inside it, is not
        // reporting this corner's apex. Skipping it is the whole point of B17.
        const apexTrustworthy =
          segment.absorbed.length === 0 &&
          segment.apexM !== null &&
          segment.apexM >= segment.fromM &&
          segment.apexM <= segment.toM &&
          segment.apexSpeed !== null;

        if (!apexTrustworthy) continue;

        if (!order.includes(segment.label)) order.push(segment.label);

        if (segment.apexSpeed !== null) {
          const list = apexByLabel.get(segment.label) ?? [];
          list.push({ lapNumber: lap.lapNumber, value: segment.apexSpeed });
          apexByLabel.set(segment.label, list);
        }

        if (segment.brakeFromM !== null) {
          const list = brakeByLabel.get(segment.label) ?? [];
          list.push({ lapNumber: lap.lapNumber, value: segment.brakeFromM });
          brakeByLabel.set(segment.label, list);
        } else {
          const list = noBrakeByLabel.get(segment.label) ?? [];
          list.push(lap.lapNumber);
          noBrakeByLabel.set(segment.label, list);
        }
      }
    }

    const rows = order.map((label) => {
      const apex = (apexByLabel.get(label) ?? []).sort((a, b) => a.value - b.value);
      const brake = (brakeByLabel.get(label) ?? []).sort((a, b) => a.value - b.value);

      const apexValues = apex.map((entry) => entry.value);
      const apexMedian = median(apexValues);
      const apexMad = madOf(apexValues, apexMedian);

      const brakeValues = brake.map((entry) => entry.value);
      const brakeMedian = median(brakeValues);
      const brakeMad = madOf(brakeValues, brakeMedian);

      // The rule is named in the UI, as the plan requires, and it never removes a lap.
      const isOutlier = (value: number, centre: number, mad: number) =>
        Number.isFinite(mad) && mad > 0 && Math.abs(value - centre) > OUTLIER_MAD * mad;

      return {
        label,
        nApex: apex.length,
        apexMedian,
        apexMad,
        apexMin: apexValues[0] ?? NaN,
        apexMax: apexValues[apexValues.length - 1] ?? NaN,
        apexOutliers: apex.filter((e) => isOutlier(e.value, apexMedian, apexMad)),
        nBrake: brake.length,
        brakeMedian,
        brakeMin: brakeValues[0] ?? NaN,
        brakeMax: brakeValues[brakeValues.length - 1] ?? NaN,
        brakeOutliers: brake.filter((e) =>
          isOutlier(e.value, brakeMedian, brakeMad),
        ),
        noBrakeLaps: noBrakeByLabel.get(label) ?? [],
      };
    });

    return { rows, counted, trafficSkipped };
  }, [telemetry, laps, corners]);

  if (failed) {
    return (
      <p className="font-mono text-[11px] text-danger">
        consistency: telemetry could not be loaded
      </p>
    );
  }

  if (!telemetry) {
    return <p className="font-mono text-[11px] text-muted">consistency: loading…</p>;
  }

  if (stats.rows.length === 0) {
    return (
      <p className="font-mono text-[11px] text-muted">
        consistency: no corner in this file could be measured on a countable lap
      </p>
    );
  }

  return (
    <section className="mt-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
          consistency
        </h2>
        <span className="font-mono text-[10px] text-muted">
          median and MAD per corner · the n beside each number is its sample size
        </span>
        <span className="font-mono text-[10px] text-muted">
          MAD is robust and is not σ — for normal data σ ≈ 1.48 · MAD
        </span>
        <span className="font-mono text-[10px] text-muted">
          outlier = |x − median| &gt; {OUTLIER_MAD} · MAD where MAD &gt; 0; marked, never
          removed
        </span>
      </header>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[10px] tabular-nums">
          <thead>
            <tr className="text-muted">
              <th className="px-2 py-1 text-left font-normal">corner</th>
              <th className="px-2 py-1 text-right font-normal">n</th>
              <th className="px-2 py-1 text-right font-normal">apex med</th>
              <th className="px-2 py-1 text-right font-normal">MAD</th>
              <th className="px-2 py-1 text-right font-normal">span</th>
              <th className="px-2 py-1 text-left font-normal">outliers</th>
              <th className="px-2 py-1 text-right font-normal">n brk</th>
              <th className="px-2 py-1 text-right font-normal">brake med</th>
              <th className="px-2 py-1 text-right font-normal">span</th>
              <th className="px-2 py-1 text-left font-normal">outliers</th>
            </tr>
          </thead>
          <tbody>
            {stats.rows.map((row) => (
              <tr key={row.label} className="border-t border-line/50">
                <th scope="row" className="px-2 py-0.5 text-left font-normal text-ink">
                  {row.label}
                </th>
                <td className="px-2 py-0.5 text-right text-muted">{row.nApex}</td>
                <td className="px-2 py-0.5 text-right">
                  {Number.isFinite(row.apexMedian)
                    ? `${oneDp.format(row.apexMedian)} km/h`
                    : "–"}
                </td>
                <td className="px-2 py-0.5 text-right text-muted">
                  {Number.isFinite(row.apexMad) ? oneDp.format(row.apexMad) : "–"}
                </td>
                <td className="px-2 py-0.5 text-right text-muted">
                  {Number.isFinite(row.apexMin) && Number.isFinite(row.apexMax)
                    ? `${oneDp.format(row.apexMin)}–${oneDp.format(row.apexMax)}`
                    : "–"}
                </td>
                <td className="px-2 py-0.5 text-left">
                  {row.apexOutliers.length === 0 ? (
                    <span className="text-muted/40">·</span>
                  ) : null}
                  {row.apexOutliers.map((outlier) => (
                    <button
                      key={outlier.lapNumber}
                      type="button"
                      onClick={() => onPickLap?.(outlier.lapNumber)}
                      title={`L${outlier.lapNumber} · ${oneDp.format(outlier.value)} km/h`}
                      className="mr-1 text-warning underline decoration-dotted underline-offset-2 hover:text-accent-700"
                    >
                      L{outlier.lapNumber}
                    </button>
                  ))}
                </td>
                <td className="px-2 py-0.5 text-right text-muted">
                  {row.nBrake}
                  {row.noBrakeLaps.length > 0 && (
                    <span
                      title={`never braked for this corner: ${row.noBrakeLaps
                        .map((n) => `L${n}`)
                        .join(", ")} — excluded from the braking point, not counted as 0`}
                      className="ml-1 text-muted/50"
                    >
                      −{row.noBrakeLaps.length}
                    </span>
                  )}
                </td>
                <td className="px-2 py-0.5 text-right">
                  {Number.isFinite(row.brakeMedian)
                    ? `${oneDp.format(row.brakeMedian)} m`
                    : "–"}
                </td>
                <td className="px-2 py-0.5 text-right text-muted">
                  {Number.isFinite(row.brakeMin) && Number.isFinite(row.brakeMax)
                    ? `${oneDp.format(row.brakeMin)}–${oneDp.format(row.brakeMax)}`
                    : "–"}
                </td>
                <td className="px-2 py-0.5 text-left">
                  {row.brakeOutliers.map((outlier) => (
                    <button
                      key={outlier.lapNumber}
                      type="button"
                      onClick={() => onPickLap?.(outlier.lapNumber)}
                      title={`L${outlier.lapNumber} · braked at ${oneDp.format(
                        outlier.value,
                      )} m`}
                      className="mr-1 text-warning underline decoration-dotted underline-offset-2 hover:text-accent-700"
                    >
                      L{outlier.lapNumber}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted">
        A corner is missing from this table when no countable lap measured it with a
        segment that actually covers it — a segment that swallowed a neighbour, or whose
        apex sits outside its own range, reports a different piece of track and is left
        out rather than averaged in. Of {laps.length} laps, {stats.counted} were countable;
        the rest were inaccurate, in the pits, or within {TRAFFIC_GAP_M} m of the car ahead
        ({stats.trafficSkipped} failed the traffic filter alone). Outliers stay in the
        median, the MAD and the span: removing them would make the driver look steadier
        than the data is.
      </p>
    </section>
  );
}
