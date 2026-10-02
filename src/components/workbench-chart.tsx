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
  loadTelemetry,
  type Telemetry,
} from "@/lib/telemetry";
import { lapStats, type ChannelStat } from "@/lib/lap-stats";
import { SkeletonChart } from "@/components/skeleton";

export type WorkbenchLap = {
  lapNumber: number;
  lapStartMs: number | null;
  lapTimeMs: number | null;
};

type PanelSpec = {
  id: string;
  title: string;
  /** Series keys in draw order; any the payload lacks are dropped, not zero-filled. */
  series: string[];
  height: number;
};

/**
 * The panel stack, top to bottom. Each panel carries its own scales — units are never
 * mixed onto one axis — and they all share a distance abscissa, so the cursor lines up
 * across the whole stack.
 */
const PANELS: PanelSpec[] = [
  { id: "speed", title: "Speed", series: ["speed"], height: 150 },
  { id: "pedals", title: "Pedals", series: ["throttle", "brake"], height: 116 },
  { id: "drivetrain", title: "Drivetrain", series: ["rpm", "gear"], height: 126 },
  { id: "aids", title: "Aids · traffic", series: ["drs", "ahead"], height: 102 },
  { id: "derived", title: "Derived", series: ["accel", "elev"], height: 114 },
];

const SYNC_KEY = "f1-workbench";

const AXIS_STYLE = {
  stroke: "#5c5f66",
  ticks: { stroke: "#d5d8db" },
  font: "10px 'IBM Plex Mono', ui-monospace, monospace",
};

type PanelData = {
  spec: PanelSpec;
  active: { spec: SeriesSpec; values: Float64Array }[];
  scaleKeys: AxisKey[];
  ranges: Partial<Record<AxisKey, [number, number]>>;
};

type Built = {
  x: Float64Array;
  elapsed: Float64Array;
  panels: PanelData[];
  readout: { key: string; label: string; unit: string; values: Float64Array }[];
  stats: ChannelStat[];
  samples: number;
  distanceM: number;
  medianStepMs: number;
  maxStepMs: number;
  /** Whole milliseconds between consecutive samples, for the step buttons. */
  typicalStepMs: number;
};

function build(
  telemetry: Telemetry,
  lap: WorkbenchLap,
  hidden: Set<string>,
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

  const panels: PanelData[] = [];
  for (const spec of PANELS) {
    if (hidden.has(spec.id)) continue;

    const active = spec.series
      .map((key) => seriesByKey(key))
      .filter((candidate): candidate is SeriesSpec =>
        candidate ? (candidate.available?.(telemetry) ?? true) : false,
      )
      .map((candidate) => ({
        spec: candidate,
        values: candidate.values(telemetry, start, end),
      }));

    if (active.length === 0) continue;

    const scaleKeys = Array.from(new Set(active.map((entry) => entry.spec.axis)));
    const ranges: Partial<Record<AxisKey, [number, number]>> = {};
    for (const key of scaleKeys) {
      const axis = AXES[key];
      ranges[key] = typeof axis.range === "function" ? axis.range(telemetry) : axis.range;
    }

    panels.push({ spec, active, scaleKeys, ranges });
  }

  const readout = panels.flatMap((panel) =>
    panel.active.map((entry) => ({
      key: entry.spec.key,
      label: entry.spec.label,
      unit: AXES[entry.spec.axis].label,
      values: entry.values,
    })),
  );

  const stats = lapStats(
    telemetry,
    lap,
    readout.map((entry) => entry.key),
  );

  return {
    x,
    elapsed,
    panels,
    readout,
    stats: stats?.stats ?? [],
    samples: size,
    distanceM: stats?.distanceM ?? x[size - 1],
    medianStepMs: stats?.medianStepMs ?? 0,
    maxStepMs: stats?.maxStepMs ?? 0,
    typicalStepMs: stats?.medianStepMs ?? 0,
  };
}

type PanelProps = {
  panel: PanelData;
  x: Float64Array;
  cursorIdx: number | null;
  showXAxis: boolean;
  onCursor: (index: number) => void;
  register: (id: string, plot: uPlot | null) => void;
};

function Panel({ panel, x, cursorIdx, showXAxis, onCursor, register }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const scales: uPlot.Scales = { x: { time: false } };
    for (const key of panel.scaleKeys) {
      scales[key] = { range: panel.ranges[key] };
    }

    // The abscissa is drawn once, on the bottom panel; the panels above keep the grid so
    // a distance can still be read off any of them.
    const xAxis: uPlot.Axis = {
      ...AXIS_STYLE,
      grid: { stroke: "#eef0f1" },
      values: showXAxis
        ? (_self, ticks) => ticks.map((tick) => `${(tick / 1000).toFixed(2)} km`)
        : () => [],
      ticks: { show: showXAxis },
      size: showXAxis ? undefined : 0,
    };

    const axes: uPlot.Axis[] = [
      xAxis,
      ...panel.scaleKeys.map((key) => ({
        ...AXIS_STYLE,
        scale: key,
        side: AXES[key].side,
        grid: { show: false },
        size: 46,
        label: AXES[key].label,
        labelSize: 18,
        labelFont: "9px 'IBM Plex Mono', ui-monospace, monospace",
      })),
    ];

    const data: uPlot.AlignedData = [x, ...panel.active.map((entry) => entry.values)];

    const plot = new uPlot(
      {
        width: container.clientWidth,
        height: panel.spec.height,
        padding: [8, 12, showXAxis ? 0 : -6, 0],
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
          ...panel.active.map((entry) => ({
            label: entry.spec.label,
            scale: entry.spec.axis,
            stroke: entry.spec.color,
            width: entry.spec.width ?? 1.4,
            dash: entry.spec.dash,
            fill: entry.spec.fill,
            points: { show: false },
          })),
        ],
        hooks: {
          setCursor: [
            (self) => {
              const index = self.cursor.idx;
              if (index !== null && index !== undefined) onCursor(index);
            },
          ],
        },
      },
      data,
      container,
    );

    register(panel.spec.id, plot);

    const onResize = () => {
      plot.setSize({ width: container.clientWidth, height: panel.spec.height });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      register(panel.spec.id, null);
      plot.destroy();
    };
  }, [panel, x, showXAxis, onCursor, register]);

  return (
    <section className="border-t border-line first:border-t-0">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 pb-1 pt-2">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
          {panel.spec.title}
        </h3>
        {panel.active.map((entry) => {
          const value =
            cursorIdx !== null && cursorIdx < entry.values.length
              ? entry.values[cursorIdx]
              : null;
          return (
            <span
              key={entry.spec.key}
              className="flex items-baseline gap-1.5 font-mono text-[10px]"
              title={entry.spec.note}
            >
              <span
                className="inline-block h-[3px] w-4 translate-y-[-2px]"
                style={{ backgroundColor: entry.spec.color }}
              />
              <span className="text-muted">{entry.spec.label}</span>
              <span className="tabular-nums text-ink">
                {value === null || !Number.isFinite(value) ? "—" : value.toFixed(1)}
              </span>
              <span className="text-muted">{AXES[entry.spec.axis].label}</span>
              {entry.spec.kind === "derived" && <span className="text-muted">*</span>}
            </span>
          );
        })}
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
};

export function WorkbenchChart({ url, lap }: Props) {
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
    () => (telemetry && lap ? build(telemetry, lap, hidden) : null),
    [telemetry, lap, hidden],
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
      ...built.readout.map((entry) => `${entry.key}[${entry.unit}]`),
    ];
    const row = [
      String(cursorIdx),
      built.x[cursorIdx].toFixed(2),
      built.elapsed[cursorIdx].toFixed(0),
      ...built.readout.map((entry) => {
        const value = entry.values[cursorIdx];
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

  const togglePanel = (id: string) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < PANELS.length - 1) next.add(id);
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

      {/* Panel switches — the stack is never emptied. */}
      <div className="flex flex-wrap gap-1.5 border-b border-line bg-canvas px-3 py-2">
        {PANELS.map((panel) => {
          const on = !hidden.has(panel.id);
          return (
            <button
              key={panel.id}
              type="button"
              onClick={() => togglePanel(panel.id)}
              disabled={on && hidden.size >= PANELS.length - 1}
              className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest transition-colors disabled:opacity-40 ${
                on
                  ? "border-accent-300 bg-paper text-ink"
                  : "border-line bg-canvas text-muted hover:text-ink"
              }`}
            >
              {panel.title}
            </button>
          );
        })}
        <span className="ml-auto font-mono text-[10px] text-muted">
          ← / → step one sample · shift 10
        </span>
      </div>

      <div className="bg-paper">
        {built.panels.map((panel, index) => (
          <Panel
            key={panel.spec.id}
            panel={panel}
            x={built.x}
            cursorIdx={cursorIdx}
            showXAxis={index === built.panels.length - 1}
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

      <p className="border-t border-line bg-paper px-3 py-2 font-mono text-[10px] leading-relaxed text-muted">
        Derived channels (*) are computed in the browser, not stored. Statistics come from
        the same functions that draw the panels. A gap is a sample the channel has no value
        for. Sampling is uneven in the F1 feed — Δs shows the median and worst spacing, and
        anything sharper than that cannot be read off this data.
      </p>
    </div>
  );
}
