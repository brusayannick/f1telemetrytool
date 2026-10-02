"use client";

import { useEffect, useMemo, useState } from "react";
import type { Corner } from "@/lib/corners";
import { buildSegments, type LapSegment } from "@/lib/segments";
import {
  formatLapTime,
  lapRange,
  lapSeries,
  loadTelemetry,
  type LapInfo,
  type Telemetry,
} from "@/lib/telemetry";

/** The plan's default traffic threshold (section 7.2, "Verkehrsschwelle"). */
const TRAFFIC_GAP_M = 300;

/**
 * A lap as the matrix needs it. `LapInfo` carries the timing fields the telemetry slice
 * needs; the flags decide whether the lap may set the column minimum.
 */
export type MatrixLap = LapInfo & {
  lapNumber: number;
  isAccurate?: boolean | null;
  pitIn?: boolean | null;
  pitOut?: boolean | null;
};

type Reason = "pit" | "inaccurate" | "traffic";

const REASON_LABEL: Record<Reason, string> = {
  pit: "pit",
  inaccurate: "inaccurate",
  traffic: `traffic <${TRAFFIC_GAP_M} m`,
};

type Row = {
  lapNumber: number;
  lapTimeMs: number | null;
  reasons: Reason[];
  byLabel: Map<string, LapSegment>;
  /** Smallest `ahead` distance recorded in the lap; null when the channel is absent. */
  minGapM: number | null;
};

type Props = {
  /** One telemetry file — it holds every lap of this driver, not one. */
  url: string;
  laps: MatrixLap[];
  corners?: Corner[] | null;
  /** Which lap is highlighted as the one open in the lane stack. */
  activeLapNumber?: number | null;
  onPickLap?: (lapNumber: number) => void;
};

const numberFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function deltaLabel(deltaMs: number): string {
  if (Math.abs(deltaMs) < 50) return "·";
  return `${deltaMs > 0 ? "+" : "−"}${numberFmt.format(Math.round(Math.abs(deltaMs)))}`;
}

/**
 * F18 — segment matrix.
 *
 * Rows are the laps, columns the segments of one lap, and each cell is the time that lap
 * spent in that segment relative to the session's best time in the same segment. Reading
 * down a column answers "who loses where"; reading across a row answers "which corners cost
 * this lap".
 *
 * Two rules from the plan are load-bearing here:
 *
 * - **Filtered laps are shown greyed, never dropped.** A lap in the pits or stuck behind
 *   another car still happened, and hiding it would make the session look cleaner than it
 *   was. It is excluded from the column minimum and marked with its reason.
 * - **A missing segment is not a zero.** When a lap's decomposition could not confirm a
 *   corner, the cell stays empty rather than reporting a time the lap never had.
 *
 * The data cost is one request: the telemetry file already covers the whole session, so
 * this costs the same as opening a single lap in the lane stack.
 */
export function SegmentMatrix({
  url,
  laps,
  corners = null,
  activeLapNumber = null,
  onPickLap,
}: Props) {
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

  const rows = useMemo<Row[]>(() => {
    if (!telemetry) return [];

    const built: Row[] = [];
    for (const lap of laps) {
      const series = lapSeries(telemetry, lap);
      if (!series) continue;

      const segments = buildSegments(series, corners);
      const byLabel = new Map<string, LapSegment>();
      for (const segment of segments) byLabel.set(segment.label, segment);

      // Traffic is a property of the lap, so it is measured here rather than guessed.
      let minGapM: number | null = null;
      const ahead = telemetry.channels.ahead;
      const range = lapRange(telemetry, lap);
      if (ahead && range) {
        for (let i = range[0]; i < range[1]; i += 1) {
          const gap = ahead[i];
          if (!Number.isFinite(gap)) continue;
          if (minGapM === null || gap < minGapM) minGapM = gap;
        }
      }

      const reasons: Reason[] = [];
      if (lap.pitIn || lap.pitOut) reasons.push("pit");
      if (lap.isAccurate === false) reasons.push("inaccurate");
      if (minGapM !== null && minGapM < TRAFFIC_GAP_M) reasons.push("traffic");

      built.push({
        lapNumber: lap.lapNumber,
        lapTimeMs: lap.lapTimeMs ?? null,
        reasons,
        byLabel,
        minGapM,
      });
    }

    return built.sort((a, b) => {
      if (a.lapTimeMs === null) return b.lapTimeMs === null ? 0 : 1;
      if (b.lapTimeMs === null) return -1;
      return a.lapTimeMs - b.lapTimeMs;
    });
  }, [telemetry, laps, corners]);

  /** Columns come from the first lap that has segments, so their order follows the lap. */
  const columns = useMemo(() => {
    for (const row of rows) {
      const segments = [...row.byLabel.values()].sort((a, b) => a.fromM - b.fromM);
      if (segments.length > 0) {
        return segments.map((segment) => ({
          label: segment.label,
          kind: segment.kind,
          fromM: segment.fromM,
        }));
      }
    }
    return [];
  }, [rows]);

  /** Only a clean lap may define the best time of a column. */
  const bestByLabel = useMemo(() => {
    const best = new Map<string, number>();
    for (const row of rows) {
      if (row.reasons.length > 0) continue;
      for (const [label, segment] of row.byLabel) {
        const current = best.get(label);
        if (current === undefined || segment.timeMs < current) {
          best.set(label, segment.timeMs);
        }
      }
    }
    return best;
  }, [rows]);

  /** The colour scale is per column, because corners differ by an order of magnitude. */
  const scaleByLabel = useMemo(() => {
    const scale = new Map<string, number>();
    for (const { label } of columns) {
      const best = bestByLabel.get(label);
      if (best === undefined) continue;
      let worst = best;
      for (const row of rows) {
        if (row.reasons.length > 0) continue;
        const segment = row.byLabel.get(label);
        if (segment && segment.timeMs > worst) worst = segment.timeMs;
      }
      scale.set(label, Math.max(worst - best, 1));
    }
    return scale;
  }, [columns, rows, bestByLabel]);

  const usableCount = rows.filter((row) => row.reasons.length === 0).length;
  const skippedCount = rows.length - usableCount;

  if (failed) {
    return (
      <p className="font-mono text-[11px] text-danger">
        segment matrix: telemetry could not be loaded
      </p>
    );
  }

  if (!telemetry) {
    return (
      <p className="font-mono text-[11px] text-muted">segment matrix: loading…</p>
    );
  }

  if (rows.length === 0 || columns.length === 0) {
    return (
      <p className="font-mono text-[11px] text-muted">
        segment matrix: no lap in this file could be decomposed
      </p>
    );
  }

  return (
    <section className="mt-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
          segment matrix
        </h2>
        <span className="font-mono text-[10px] text-muted">
          {rows.length} laps × {columns.length} segments
        </span>
        <span className="font-mono text-[10px] text-muted">
          best per column from {usableCount} clean laps
          {skippedCount > 0 ? `, ${skippedCount} shown but not counted` : ""}
        </span>
        <span className="font-mono text-[10px] text-muted">
          value = time in segment above the session best
        </span>
      </header>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[10px] tabular-nums">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-surface px-2 py-1 text-left font-normal text-muted">
                lap
              </th>
              {(columns ?? []).map((column) => (
                <th
                  key={column.label}
                  title={`${column.label} · from ${numberFmt.format(column.fromM)} m`}
                  className={`whitespace-nowrap px-1 py-1 text-right font-normal ${
                    column.kind === "straight" ? "text-muted/60" : "text-muted"
                  }`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const filtered = row.reasons.length > 0;
              const active = row.lapNumber === activeLapNumber;
              return (
                <tr
                  key={row.lapNumber}
                  className={active ? "bg-accent-50" : undefined}
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-surface px-2 py-0.5 text-left font-normal"
                  >
                    <button
                      type="button"
                      onClick={() => onPickLap?.(row.lapNumber)}
                      className={`flex items-baseline gap-2 whitespace-nowrap ${
                        onPickLap ? "hover:text-accent-700" : "cursor-default"
                      }`}
                    >
                      <span className={filtered ? "text-muted/60" : "text-ink"}>
                        L{row.lapNumber}
                      </span>
                      <span className={filtered ? "text-muted/60" : "text-muted"}>
                        {formatLapTime(row.lapTimeMs)}
                      </span>
                      {filtered && (
                        <span className="text-[9px] text-warning">
                          {row.reasons.map((reason) => REASON_LABEL[reason]).join(" · ")}
                        </span>
                      )}
                    </button>
                  </th>
                  {(columns ?? []).map((column) => {
                    const segment = row.byLabel.get(column.label);
                    if (!segment) {
                      return (
                        <td
                          key={column.label}
                          title={`${column.label} · not confirmed on this lap`}
                          className="px-1 py-0.5 text-right text-muted/30"
                        >
                          –
                        </td>
                      );
                    }

                    const best = bestByLabel.get(column.label);
                    const deltaMs =
                      best === undefined ? null : segment.timeMs - best;
                    const span = scaleByLabel.get(column.label) ?? 1;
                    const intensity =
                      deltaMs === null || deltaMs <= 0
                        ? 0
                        : Math.min(0.55, (deltaMs / span) * 0.55);

                    return (
                      <td
                        key={column.label}
                        title={`${column.label} · ${segment.timeMs.toFixed(0)} ms${
                          deltaMs === null
                            ? " · no clean reference"
                            : ` · ${deltaMs >= 0 ? "+" : "−"}${Math.round(
                                Math.abs(deltaMs),
                              )} ms vs best`
                        }`}
                        style={
                          intensity > 0
                            ? { backgroundColor: `rgba(220, 38, 38, ${intensity.toFixed(3)})` }
                            : undefined
                        }
                        className={`px-1 py-0.5 text-right ${
                          filtered
                            ? "opacity-40"
                            : deltaMs !== null && deltaMs < 50
                              ? "text-muted"
                              : "text-ink"
                        }`}
                      >
                        {deltaMs === null ? "·" : deltaLabel(deltaMs)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted">
        Every lap in the file is a row — {skippedCount > 0 ? "filtered ones are greyed" : "none were filtered"}.
        A greyed lap still ran, so it is shown; it is excluded from the column best.
        &ldquo;–&rdquo; means the lap could not confirm that corner — it is not a zero,
        and the neighbouring corner&rsquo;s apex is not reported in its place.
      </p>
    </section>
  );
}
