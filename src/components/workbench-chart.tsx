"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import {
  AXES,
  seriesByKey,
  type AxisKey,
  type SeriesSpec,
} from "@/lib/channels";
import {
  formatLapTime,
  lapRange,
  lapSeries,
  loadTelemetry,
  type Telemetry,
} from "@/lib/telemetry";
import { lapStats, type ChannelStat } from "@/lib/lap-stats";
import {
  annotationMarks,
  buildSegments,
  segmentTotalMs,
  type LapSegment,
} from "@/lib/segments";
import type { Corner } from "@/lib/corners";
import { SkeletonChart } from "@/components/skeleton";

export type WorkbenchLap = {
  lapNumber: number;
  lapStartMs: number | null;
  lapTimeMs: number | null;
};

type LaneSpec = {
  /** One channel key from the registry — never two signals sharing a baseline. */
  key: string;
  height: number;
};

/**
 * One lane per channel, top to bottom — the layout a telemetry engineer expects.
 *
 * Every signal gets its own baseline, its own unit and its own scale, and they all share
 * one distance abscissa, so a feature in one lane lines up vertically with its cause in
 * another. Heights differ on purpose: speed carries the shape of the lap, while a
 * discrete signal like gear or DRS only needs enough room to read a step.
 */
const LANES: LaneSpec[] = [
  { key: "speed", height: 104 },
  { key: "throttle", height: 62 },
  { key: "brake", height: 54 },
  { key: "rpm", height: 70 },
  { key: "gear", height: 50 },
  { key: "drs", height: 44 },
  { key: "ahead", height: 52 },
  { key: "accel", height: 66 },
  { key: "elev", height: 44 },
  { key: "coast", height: 36 },
  { key: "trail", height: 36 },
  { key: "progress", height: 36 },
];

const SYNC_KEY = "f1-workbench";

const AXIS_STYLE = {
  stroke: "#5c5f66",
  ticks: { stroke: "#d5d8db" },
  font: "10px 'IBM Plex Mono', ui-monospace, monospace",
};

type LaneData = {
  spec: LaneSpec;
  series: SeriesSpec;
  values: Float64Array;
  axis: AxisKey;
  range: [number, number];
  label: string;
  unit: string;
};

type Built = {
  x: Float64Array;
  elapsed: Float64Array;
  lanes: LaneData[];
  stats: ChannelStat[];
  /** The lap split into corners and straights — the shared decomposition. */
  segments: LapSegment[];
  /** Distance of every corner's apex, for the annotation lines. */
  marks: number[];
  /** Sum of the segment times; must match the telemetry span exactly. */
  segmentTotalMs: number;
  /** Duration the telemetry window actually covers — what the segments tile. */
  spanMs: number;
  /** Corners the lap could not confirm and which were therefore left out. */
  skippedCorners: number;
  samples: number;
  distanceM: number;
  medianStepMs: number;
  maxStepMs: number;
};

function build(
  telemetry: Telemetry,
  lap: WorkbenchLap,
  hidden: Set<string>,
  corners: Corner[] | null,
): Built | null {
  const range = lapRange(telemetry, lap);
  if (!range) return null;

  const [start, end] = range;
  const size = end - start;
  const { dist, t } = telemetry.channels;
  const origin = dist[start];
  const lapStart = lap.lapStartMs === null ? 0 : lap.lapStartMs - telemetry.t0ms;

  const x = new Float64Array(size);
  const elapsed = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    x[i] = dist[start + i] - origin;
    elapsed[i] = t[start + i] - lapStart;
  }

  // One lane per channel. A channel this payload does not carry is dropped, never drawn
  // as a line of zeros.
  const lanes: LaneData[] = [];
  for (const lane of LANES) {
    if (hidden.has(lane.key)) continue;

    const spec = seriesByKey(lane.key);
    if (!spec) continue;
    if (!(spec.available?.(telemetry) ?? true)) continue;

    const axis = AXES[spec.axis];
    lanes.push({
      spec: lane,
      series: spec,
      values: spec.values(telemetry, start, end),
      axis: spec.axis,
      range: typeof axis.range === "function" ? axis.range(telemetry) : axis.range,
      label: spec.label,
      unit: axis.label,
    });
  }

  const stats = lapStats(
    telemetry,
    lap,
    lanes.map((lane) => lane.series.key),
  );

  // The lap decomposition everything analytical reads from. Built from the same lap slice
  // as the lanes, so a corner boundary and the trace agree by construction.
  const series = lapSeries(telemetry, lap);
  const segments = series ? buildSegments(series, corners) : [];
  // Markers come from every corner in the database; the segment table only carries the
  // corners the lap could confirm. The gap between the two is surfaced, not smoothed over.
  const marks = series ? annotationMarks(series, corners) : [];
  const measuredCorners = segments.filter((segment) => segment.kind === "corner").length;

  // The official lap time is NOT the right thing to check the sum against: the telemetry
  // window is short by up to a sample, so a correct decomposition still lands tens to
  // hundreds of milliseconds under the timing figure. The span is what the segments tile.
  const spanMs = size > 1 ? elapsed[size - 1] - elapsed[0] : 0;

  return {
    x,
    elapsed,
    lanes,
    stats: stats?.stats ?? [],
    segments,
    marks,
    segmentTotalMs: segmentTotalMs(segments),
    spanMs,
    skippedCorners: Math.max(0, marks.length - measuredCorners),
    samples: size,
    distanceM: stats?.distanceM ?? x[size - 1],
    medianStepMs: stats?.medianStepMs ?? 0,
    maxStepMs: stats?.maxStepMs ?? 0,
  };
}

type LaneProps = {
  lane: LaneData;
  x: Float64Array;
  cursorIdx: number | null;
  showXAxis: boolean;
  /** Corner apex distances, drawn as vertical lines so every lane shares the annotation. */
  marks: number[];
  onCursor: (index: number) => void;
  register: (id: string, plot: uPlot | null) => void;
};

/**
 * One channel, one lane.
 *
 * The channel name and its live value sit in the lane's own header rather than in a
 * legend, so the eye can run down the left edge of the stack and read every channel at
 * the cursor position without moving.
 */
function Lane({ lane, x, cursorIdx, showXAxis, marks, onCursor, register }: LaneProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const scales: uPlot.Scales = {
      x: { time: false },
      [lane.axis]: { range: lane.range },
    };

    // The abscissa is labelled once, at the bottom of the stack; every lane above keeps
    // the grid so a distance can still be read off any of them.
    const axes: uPlot.Axis[] = [
      {
        ...AXIS_STYLE,
        grid: { stroke: "#eef0f1" },
        ticks: { stroke: "#d5d8db", show: showXAxis },
        values: showXAxis
          ? (_self, ticks) => ticks.map((tick) => `${(tick / 1000).toFixed(2)} km`)
          : () => [],
        size: showXAxis ? undefined : 0,
      },
      {
        ...AXIS_STYLE,
        scale: lane.axis,
        side: 0,
        grid: { stroke: "#f4f5f6" },
        size: 54,
        label: lane.unit,
        labelSize: 18,
        labelFont: "9px 'IBM Plex Mono', ui-monospace, monospace",
      },
    ];

    const plot = new uPlot(
      {
        width: container.clientWidth,
        height: lane.spec.height,
        padding: [6, 12, showXAxis ? 0 : -6, 0],
        cursor: {
          show: true,
          x: true,
          y: false,
          points: { show: false },
          sync: { key: SYNC_KEY, scales: ["x", null] },
        },
        legend: { show: false },
        scales,
        axes,
        series: [
          {},
          {
            label: lane.label,
            scale: lane.axis,
            stroke: lane.series.color,
            width: lane.series.width ?? 1.2,
            dash: lane.series.dash,
            fill: lane.series.fill,
            points: { show: false },
          },
        ],
        hooks: {
          setCursor: [
            (self) => {
              const index = self.cursor.idx;
              if (index !== null && index !== undefined) onCursor(index);
            },
          ],
          // Corner marks are drawn onto the canvas rather than added as data series: a
          // vertical line is an annotation, not a measurement, and must not show up in
          // the statistics table or the cursor readout.
          draw: [
            (self) => {
              if (marks.length === 0) return;
              const { ctx, bbox } = self;
              const right = bbox.left + bbox.width;
              ctx.save();
              ctx.strokeStyle = "#c9ccd0";
              ctx.lineWidth = 1;
              ctx.setLineDash([2, 3]);
              ctx.beginPath();
              for (const distance of marks) {
                const px = self.valToPos(distance, "x");
                if (px < bbox.left || px > right) continue;
                ctx.moveTo(px, bbox.top);
                ctx.lineTo(px, bbox.top + bbox.height);
              }
              ctx.stroke();
              ctx.restore();
            },
          ],
        },
      },
      [x, lane.values] as uPlot.AlignedData,
      container,
    );

    register(lane.spec.key, plot);

    const onResize = () => {
      plot.setSize({ width: container.clientWidth, height: lane.spec.height });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      register(lane.spec.key, null);
      plot.destroy();
    };
  }, [lane, x, showXAxis, marks, onCursor, register]);

  const value =
    cursorIdx !== null && cursorIdx < lane.values.length ? lane.values[cursorIdx] : null;

  return (
    <section className="border-t border-line first:border-t-0">
      <header className="flex items-baseline gap-2 px-3 pt-1.5 font-mono text-[10px]">
        <span
          className="inline-block h-[3px] w-4 translate-y-[-2px]"
          style={{ backgroundColor: lane.series.color }}
        />
        <h3 className="w-24 shrink-0 uppercase tracking-[0.14em] text-muted">
          {lane.label}
          {lane.series.kind === "derived" && <span>*</span>}
        </h3>
        <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-ink">
          {value === null || !Number.isFinite(value) ? "—" : value.toFixed(1)}
        </span>
        <span className="text-muted">{lane.unit}</span>
        <span
          className="ml-auto hidden truncate text-[9px] text-muted sm:block"
          title={lane.series.note}
        >
          {lane.series.note}
        </span>
      </header>
      <div ref={ref} className="w-full" />
    </section>
  );
}

function figure(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

type Props = {
  url: string;
  lap: WorkbenchLap | null;
  /** Curated corner database for this event; null falls back to detection. */
  corners?: Corner[] | null;
};

export function WorkbenchChart({ url, lap, corners = null }: Props) {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [cursorIdx, setCursorIdx] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const plots = useRef(new Map<string, uPlot>());

  useEffect(() => {
    let cancelled = false;
    setTelemetry(null);
    setError(null);
    setCursorIdx(null);

    loadTelemetry(url)
      .then((data) => {
        if (!cancelled) setTelemetry(data);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  const built = useMemo(
    () => (telemetry && lap ? build(telemetry, lap, hidden, corners) : null),
    [telemetry, lap, hidden, corners],
  );

  const register = useCallback((id: string, plot: uPlot | null) => {
    if (plot) plots.current.set(id, plot);
    else plots.current.delete(id);
  }, []);

  // Stepping the cursor one sample at a time is how you read an exact value off a trace
  // that is sampled at ~7 Hz: the mouse can only get you within a few metres.
  const onCursor = useCallback((index: number) => {
    setCursorIdx((current) => (current === index ? current : index));
  }, []);

  const seek = useCallback(
    (delta: number) => {
      if (!built || built.samples === 0) return;
      const from = cursorIdx ?? 0;
      const next = Math.min(built.samples - 1, Math.max(0, from + delta));
      setCursorIdx(next);
      const distance = built.x[next];
      for (const plot of plots.current.values()) {
        plot.setCursor({ left: plot.valToPos(distance, "x"), top: 10 }, false);
      }
    },
    [built, cursorIdx],
  );

  const copySample = useCallback(async () => {
    if (!built || cursorIdx === null || cursorIdx >= built.samples) return;
    const header = [
      "sample",
      "distance_m",
      "elapsed_ms",
      ...built.lanes.map((lane) => `${lane.series.key}[${lane.unit}]`),
    ];
    const row = [
      String(cursorIdx),
      built.x[cursorIdx].toFixed(2),
      built.elapsed[cursorIdx].toFixed(0),
      ...built.lanes.map((lane) => {
        const value = lane.values[cursorIdx];
        return Number.isFinite(value) ? value.toFixed(4) : "NaN";
      }),
    ];
    try {
      await navigator.clipboard.writeText(`${header.join("\t")}\n${row.join("\t")}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }, [built, cursorIdx]);

  const toggleLane = (key: string) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else if (next.size < LANES.length - 1) next.add(key);
      return next;
    });
  };

  if (error) {
    return <p className="py-6 font-mono text-xs text-danger">telemetry: {error}</p>;
  }

  if (!lap) {
    return <p className="py-6 font-mono text-xs text-muted">select a lap</p>;
  }

  if (!built) {
    return <SkeletonChart height={520} />;
  }

  const cursorDistance =
    cursorIdx !== null && cursorIdx < built.samples ? built.x[cursorIdx] : null;
  const cursorElapsed =
    cursorIdx !== null && cursorIdx < built.samples ? built.elapsed[cursorIdx] : null;

  return (
    <div
      className="focus:outline-none"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          seek(event.shiftKey ? -10 : -1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          seek(event.shiftKey ? 10 : 1);
        }
      }}
    >
      {/* Sample-level readout: the numbers behind whatever the cursor is on. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-paper px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => seek(-1)}
            className="rounded border border-line px-2 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-accent-300 hover:text-ink"
            title="Previous sample (←)"
          >
            ◀
          </button>
          <button
            type="button"
            onClick={() => seek(1)}
            className="rounded border border-line px-2 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-accent-300 hover:text-ink"
            title="Next sample (→), hold Shift for 10"
          >
            ▶
          </button>
          <button
            type="button"
            onClick={copySample}
            disabled={cursorIdx === null}
            className="rounded border border-line px-2 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-accent-300 hover:text-ink disabled:opacity-40"
            title="Copy this sample as TSV"
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>

        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {[
            ["sample", cursorIdx === null ? "—" : String(cursorIdx)],
            ["dist", cursorDistance === null ? "—" : `${cursorDistance.toFixed(0)} m`],
            ["t", cursorElapsed === null ? "—" : formatLapTime(cursorElapsed)],
            ["lap", formatLapTime(lap.lapTimeMs)],
            ["n", String(built.samples)],
            ["Δs", `${built.medianStepMs.toFixed(0)} ms`],
            ["max Δs", `${built.maxStepMs.toFixed(0)} ms`],
            ["len", `${(built.distanceM / 1000).toFixed(3)} km`],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-1.5">
              <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
                {label}
              </dt>
              <dd className="font-mono text-[11px] tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Channel switches — one per lane; the stack is never emptied. */}
      <div className="flex flex-wrap gap-1 border-b border-line bg-canvas px-3 py-1.5">
        {LANES.map((lane) => {
          const spec = seriesByKey(lane.key);
          const available = spec
            ? telemetry
              ? (spec.available?.(telemetry) ?? true)
              : false
            : false;
          const on = !hidden.has(lane.key);
          return (
            <button
              key={lane.key}
              type="button"
              onClick={() => toggleLane(lane.key)}
              disabled={!available || (on && hidden.size >= LANES.length - 1)}
              title={spec?.note}
              className={`border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] transition-colors disabled:opacity-30 ${
                on
                  ? "border-accent-300 bg-paper text-ink"
                  : "border-line text-muted hover:text-ink"
              }`}
            >
              {spec?.label ?? lane.key}
            </button>
          );
        })}
        <span className="ml-auto font-mono text-[9px] text-muted">
          ← / → step one sample · shift 10
        </span>
      </div>

      <div className="bg-paper">
        {built.lanes.map((lane, index) => (
          <Lane
            key={lane.spec.key}
            lane={lane}
            x={built.x}
            cursorIdx={cursorIdx}
            showXAxis={index === built.lanes.length - 1}
            marks={built.marks}
            onCursor={onCursor}
            register={register}
          />
        ))}
      </div>

      {/* Statistics for exactly the channels on screen, from the same code that draws them. */}
      <div className="overflow-x-auto border-t border-line bg-paper">
        <table className="w-full border-collapse font-mono text-[11px] tabular-nums">
          <thead>
            <tr className="border-b border-line text-left text-[9px] uppercase tracking-[0.14em] text-muted">
              <th className="px-3 py-2 font-normal">channel</th>
              <th className="px-3 py-2 text-right font-normal">min</th>
              <th className="px-3 py-2 text-right font-normal">at</th>
              <th className="px-3 py-2 text-right font-normal">max</th>
              <th className="px-3 py-2 text-right font-normal">at</th>
              <th className="px-3 py-2 text-right font-normal">mean</th>
              <th className="px-3 py-2 text-right font-normal">σ</th>
              <th className="px-3 py-2 text-right font-normal">duty</th>
              <th className="px-3 py-2 text-right font-normal">gaps</th>
            </tr>
          </thead>
          <tbody>
            {built.stats.map((stat) => (
              <tr key={stat.key} className="border-b border-line/60">
                <td className="px-3 py-1.5">
                  {stat.label}
                  <span className="ml-1.5 text-muted">{stat.unit}</span>
                </td>
                <td className="px-3 py-1.5 text-right">{figure(stat.min)}</td>
                <td className="px-3 py-1.5 text-right text-muted">
                  {stat.minAtM.toFixed(0)} m
                </td>
                <td className="px-3 py-1.5 text-right">{figure(stat.max)}</td>
                <td className="px-3 py-1.5 text-right text-muted">
                  {stat.maxAtM.toFixed(0)} m
                </td>
                <td className="px-3 py-1.5 text-right">{figure(stat.mean)}</td>
                <td className="px-3 py-1.5 text-right text-muted">{figure(stat.std)}</td>
                <td className="px-3 py-1.5 text-right">
                  {stat.dutyPct.toFixed(0)}%
                </td>
                <td
                  className={`px-3 py-1.5 text-right ${
                    stat.gaps > 0 ? "text-warning" : "text-muted"
                  }`}
                >
                  {stat.gaps}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The shared lap decomposition: corners and the straights between them. Everything
          analytical reads from this, so segment times cannot disagree with the lanes. */}
      {built.segments.length > 0 ? (
        <div className="overflow-x-auto border-t border-line bg-paper">
          <table className="w-full border-collapse font-mono text-[11px] tabular-nums">
            <thead>
              <tr className="border-b border-line text-left text-[9px] uppercase tracking-[0.14em] text-muted">
                <th className="px-3 py-2 font-normal">segment</th>
                <th className="px-3 py-2 text-right font-normal">from</th>
                <th className="px-3 py-2 text-right font-normal">to</th>
                <th className="px-3 py-2 text-right font-normal">len</th>
                <th className="px-3 py-2 text-right font-normal">time</th>
                <th className="px-3 py-2 text-right font-normal">apex</th>
                <th className="px-3 py-2 text-right font-normal">brake from</th>
                <th className="px-3 py-2 text-right font-normal">exit</th>
              </tr>
            </thead>
            <tbody>
              {built.segments.map((segment) => (
                <tr
                  key={`${segment.label}-${segment.fromM}`}
                  className="border-b border-line/60"
                >
                  <td className="px-3 py-1.5">
                    {segment.label}
                    {segment.kind === "straight" && (
                      <span className="ml-1.5 text-muted">straight</span>
                    )}
                    {!segment.verified && <span className="ml-1.5 text-warning">?</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted">
                    {segment.fromM.toFixed(0)} m
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted">
                    {segment.toM.toFixed(0)} m
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted">
                    {(segment.toM - segment.fromM).toFixed(0)} m
                  </td>
                  <td className="px-3 py-1.5 text-right">{segment.timeMs.toFixed(0)} ms</td>
                  <td className="px-3 py-1.5 text-right">
                    {segment.apexSpeed === null
                      ? "—"
                      : `${segment.apexSpeed.toFixed(0)} km/h`}
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted">
                    {segment.brakeFromM === null
                      ? "—"
                      : `${segment.brakeFromM.toFixed(0)} m`}
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted">
                    {segment.exitM === null ? "—" : `${segment.exitM.toFixed(0)} m`}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line text-[10px]">
                <td className="px-3 py-2 text-muted" colSpan={4}>
                  Σ {built.segments.length} segments
                  {built.skippedCorners > 0 && (
                    <span className="text-warning">
                      {" "}
                      · {built.marks.length} corner markers, {built.skippedCorners} without an
                      apex in their own stretch — drawn but not measured
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{built.segmentTotalMs.toFixed(0)} ms</td>
                <td className="px-3 py-2 text-right text-muted" colSpan={3}>
                  span {built.spanMs.toFixed(0)} ms
                  <span
                    className={
                      Math.abs(built.segmentTotalMs - built.spanMs) < 1
                        ? " text-success"
                        : " text-danger"
                    }
                  >
                    {" "}
                    Δ {(built.segmentTotalMs - built.spanMs).toFixed(0)} ms
                  </span>
                  {" · "}lap {formatLapTime(lap.lapTimeMs)}
                  {lap.lapTimeMs !== null && (
                    <span className="text-muted">
                      {" "}
                      (window {(built.spanMs - lap.lapTimeMs).toFixed(0)} ms)
                    </span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      <p className="border-t border-line bg-paper px-3 py-2 font-mono text-[10px] leading-relaxed text-muted">
        One lane per channel, all on the same distance axis. Derived channels (*) are
        computed in the browser, not stored. Statistics and segment times come from the same
        functions that draw the lanes. A gap is a sample the channel has no value for.
        Sampling is uneven in the F1 feed — Δs shows the median and worst spacing, and
        anything sharper than that cannot be read off this data. Segments tile the lap, so
        their times must sum to the telemetry span — that Δ must be zero. The official lap
        time is a different, larger number: the telemetry window is short by up to one
        sample, which is why it is reported separately as “window”.
      </p>
    </div>
  );
}
