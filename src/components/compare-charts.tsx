"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import {
  deltaTrace,
  formatLapTime,
  gridSeries,
  lapPosition,
  lapSeries,
  loadTelemetry,
  type DeltaTrace,
  type LapSeries,
  type Telemetry,
} from "@/lib/telemetry";
import { SkeletonChart } from "@/components/skeleton";
import { TrackMap } from "@/components/track-map";
import {
  cornerDeltas,
  cornerPerformance,
  type Corner,
  type CornerDelta,
} from "@/lib/corners";

export type LapRef = {
  lapNumber: number;
  lapStartMs: number | null;
  lapTimeMs: number | null;
};

export type CompareSide = {
  url: string;
  lap: LapRef;
  label: string; // driver code, e.g. "VER"
};

const COLOUR_A = "#005f73";
const COLOUR_B = "#c2410c";
const HEIGHT = 200;
const PADDING: [number, number, number, number] = [12, 12, 0, 0];

const axisStyle = {
  stroke: "#5c5f66",
  grid: { stroke: "#e7e8ea" },
  ticks: { stroke: "#e7e8ea" },
  font: "11px 'IBM Plex Mono', ui-monospace, monospace",
};

function kmTicks(_self: uPlot, ticks: number[]) {
  return ticks.map((tick) => `${(tick / 1000).toFixed(1)} km`);
}

/** Create a uPlot instance in a container, resizing with the window. */
function useChart(
  ref: React.RefObject<HTMLDivElement | null>,
  data: uPlot.AlignedData | null,
  options: Omit<uPlot.Options, "width" | "height"> | null,
) {
  useEffect(() => {
    const container = ref.current;
    if (!container || !data || !options) return;

    const chart = new uPlot(
      { ...options, width: container.clientWidth, height: HEIGHT },
      data,
      container,
    );
    const onResize = () => chart.setSize({ width: container.clientWidth, height: HEIGHT });
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.destroy();
    };
  }, [ref, data, options]);
}

type Built = {
  speed: uPlot.AlignedData;
  pedals: uPlot.AlignedData;
  delta: uPlot.AlignedData;
  trace: DeltaTrace;
  endDistanceM: number;
  totalDeltaMs: number;
  /** Median spacing between telemetry samples — the resolution limit of the trace. */
  sampleIntervalMs: number;
  biggestGainMs: number;
  biggestGainAtM: number;
  biggestLossMs: number;
  biggestLossAtM: number;
  corners: CornerDelta[] | null;
};

function medianStep(times: Float64Array): number {
  if (times.length < 3) return 0;
  const steps: number[] = [];
  for (let i = 1; i < times.length; i += 1) steps.push(times[i] - times[i - 1]);
  steps.sort((x, y) => x - y);
  return steps[Math.floor(steps.length / 2)];
}

function build(a: LapSeries, b: LapSeries, corners: Corner[] | null): Built | null {
  const gridA = gridSeries(a);
  const gridB = gridSeries(b);
  if (!gridA || !gridB) return null;

  const trace = deltaTrace(gridA, gridB);

  const speed: uPlot.AlignedData = [
    gridA.dist,
    gridA.speed,
    gridB.speed.slice(0, gridA.dist.length),
  ];

  const pedals: uPlot.AlignedData = [
    gridA.dist,
    gridA.thr,
    gridA.brk,
    gridB.thr.slice(0, gridA.dist.length),
    gridB.brk.slice(0, gridA.dist.length),
  ];

  const slower = Array.from(trace.delta, (value) => (value > 0 ? value / 1000 : null));
  const faster = Array.from(trace.delta, (value) => (value <= 0 ? value / 1000 : null));
  const zero = new Float64Array(trace.dist.length);

  const delta: uPlot.AlignedData = [
    trace.dist,
    zero,
    slower as unknown as number[],
    faster as unknown as number[],
  ];

  let biggestGainMs = 0;
  let biggestGainAtM = 0;
  let biggestLossMs = 0;
  let biggestLossAtM = 0;
  for (let i = 0; i < trace.delta.length; i += 1) {
    const value = trace.delta[i];
    if (value < biggestGainMs) {
      biggestGainMs = value;
      biggestGainAtM = trace.dist[i];
    }
    if (value > biggestLossMs) {
      biggestLossMs = value;
      biggestLossAtM = trace.dist[i];
    }
  }

  const cornerMetrics =
    corners && corners.length > 0
      ? cornerDeltas(cornerPerformance(a, corners), cornerPerformance(b, corners), trace)
      : null;

  return {
    speed,
    pedals,
    delta,
    trace,
    endDistanceM: trace.dist[trace.dist.length - 1] ?? 0,
    totalDeltaMs: trace.delta[trace.delta.length - 1] ?? 0,
    sampleIntervalMs: medianStep(a.time),
    biggestGainMs,
    biggestGainAtM,
    biggestLossMs,
    biggestLossAtM,
    corners: cornerMetrics,
  };
}

export function CompareCharts({
  a,
  b,
  corners = null,
}: {
  a: CompareSide;
  b: CompareSide;
  corners?: Corner[] | null;
}) {
  const speedRef = useRef<HTMLDivElement>(null);
  const pedalsRef = useRef<HTMLDivElement>(null);
  const deltaRef = useRef<HTMLDivElement>(null);

  const [telemetryA, setTelemetryA] = useState<Telemetry | null>(null);
  const [telemetryB, setTelemetryB] = useState<Telemetry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTelemetryA(null);
    setTelemetryB(null);
    setError(null);

    Promise.all([loadTelemetry(a.url), loadTelemetry(b.url)])
      .then(([first, second]) => {
        if (cancelled) return;
        setTelemetryA(first);
        setTelemetryB(second);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [a.url, b.url]);

  const built = useMemo(() => {
    if (!telemetryA || !telemetryB) return null;
    const seriesA = lapSeries(telemetryA, a.lap);
    const seriesB = lapSeries(telemetryB, b.lap);
    if (!seriesA || !seriesB) return null;
    return build(seriesA, seriesB, corners);
  }, [telemetryA, telemetryB, a.lap, b.lap, corners]);

  const position = useMemo(
    () => (telemetryA ? lapPosition(telemetryA, a.lap) : null),
    [telemetryA, a.lap],
  );

  const syncOptions = useMemo(
    () => ({ cursor: { sync: { key: "f1-telemetry" } } as uPlot.Cursor, scales: { x: { time: false } } }),
    [],
  );

  const speedOptions = useMemo(
    () => ({
      ...syncOptions,
      legend: { show: true, live: false },
      padding: PADDING,
      scales: { ...syncOptions.scales, y: { range: [0, 350] as [number, number] } },
      axes: [
        { ...axisStyle, values: kmTicks },
        { ...axisStyle, scale: "y", label: "km/h", labelSize: 18, labelFont: axisStyle.font },
      ],
      series: [
        {},
        { label: `${a.label} speed`, scale: "y", stroke: COLOUR_A, width: 2 },
        { label: `${b.label} speed`, scale: "y", stroke: COLOUR_B, width: 2 },
      ],
    }),
    [a.label, b.label, syncOptions],
  );

  const pedalOptions = useMemo(
    () => ({
      ...syncOptions,
      legend: { show: true, live: false },
      padding: PADDING,
      scales: { ...syncOptions.scales, y: { range: [0, 100] as [number, number] } },
      axes: [
        { ...axisStyle, values: kmTicks },
        { ...axisStyle, scale: "y", label: "%", labelSize: 18, labelFont: axisStyle.font },
      ],
      series: [
        {},
        { label: `${a.label} throttle`, scale: "y", stroke: COLOUR_A, width: 1.5 },
        { label: `${a.label} brake`, scale: "y", stroke: COLOUR_A, width: 1.5, dash: [4, 3] },
        { label: `${b.label} throttle`, scale: "y", stroke: COLOUR_B, width: 1.5 },
        { label: `${b.label} brake`, scale: "y", stroke: COLOUR_B, width: 1.5, dash: [4, 3] },
      ],
    }),
    [a.label, b.label, syncOptions],
  );

  const deltaOptions = useMemo(
    () => ({
      ...syncOptions,
      legend: { show: false },
      padding: PADDING,
      scales: { ...syncOptions.scales, y: { range: undefined } },
      axes: [
        { ...axisStyle, values: kmTicks },
        {
          ...axisStyle,
          scale: "y",
          label: "s",
          labelSize: 18,
          labelFont: axisStyle.font,
        },
      ],
      series: [
        {},
        { label: "zero", scale: "y", show: false },
        {
          label: `${b.label} slower`,
          scale: "y",
          stroke: "#c92a2a",
          fill: "rgba(201, 42, 42, 0.18)",
          width: 1.5,
          fillTo: 1,
        },
        {
          label: `${b.label} faster`,
          scale: "y",
          stroke: "#2b8a3e",
          fill: "rgba(43, 138, 62, 0.18)",
          width: 1.5,
          fillTo: 1,
        },
      ],
    }),
    [b.label, syncOptions],
  );

  useChart(speedRef, built?.speed ?? null, built ? speedOptions : null);
  useChart(pedalsRef, built?.pedals ?? null, built ? pedalOptions : null);
  useChart(deltaRef, built?.delta ?? null, built ? deltaOptions : null);

  if (error) {
    return <p className="py-6 text-sm text-danger">Telemetry unavailable: {error}</p>;
  }

  if (!built) {
    return (
      <div className="space-y-4">
        <SkeletonChart height={HEIGHT} />
        <SkeletonChart height={HEIGHT} />
        <SkeletonChart height={HEIGHT} />
      </div>
    );
  }

  const seconds = (ms: number) => `${ms >= 0 ? "+" : "−"}${Math.abs(ms / 1000).toFixed(3)}s`;

  const signed = (value: number, digits: number, unit = "") =>
    `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}${unit}`;

  // Authoritative: the timing data. The telemetry trace cannot reproduce it exactly.
  const officialGapMs =
    a.lap.lapTimeMs !== null && b.lap.lapTimeMs !== null
      ? b.lap.lapTimeMs - a.lap.lapTimeMs
      : built.totalDeltaMs;

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-muted">
          Speed · {a.label} vs {b.label}
        </p>
        <div ref={speedRef} className="w-full" />
      </div>

      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-muted">
          Throttle (solid) + brake (dashed)
        </p>
        <div ref={pedalsRef} className="w-full" />
      </div>

      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-muted">
          Track — where {b.label} gains and loses
        </p>
        <TrackMap
          position={position}
          delta={built.trace}
          baseLabel={a.label}
          otherLabel={b.label}
        />
      </div>

      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-muted">
          Delta — {b.label} relative to {a.label}
        </p>
        <div ref={deltaRef} className="w-full" />
      </div>

      {built.corners && built.corners.length > 0 ? (
        <div>
          <p className="mb-3 font-mono text-[11px] uppercase tracking-widest text-muted">
            Corner by corner — {b.label} relative to {a.label}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-widest text-muted">
                  <th className="py-2 pr-3 font-normal">Corner</th>
                  <th className="py-2 pr-3 text-right font-normal">Apex {a.label}</th>
                  <th className="py-2 pr-3 text-right font-normal">Apex {b.label}</th>
                  <th className="py-2 pr-3 text-right font-normal">Apex Δ</th>
                  <th className="py-2 pr-3 text-right font-normal">Brake</th>
                  <th className="py-2 pr-3 text-right font-normal">Exit Δ</th>
                  <th className="py-2 text-right font-normal">Time Δ</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs tabular-nums">
                {built.corners.map((corner) => (
                  <tr key={corner.label} className="border-b border-line/60">
                    <td className="py-1.5 pr-3">{corner.label}</td>
                    <td className="py-1.5 pr-3 text-right text-muted">
                      {corner.apexSpeedA.toFixed(0)}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-muted">
                      {corner.apexSpeedB.toFixed(0)}
                    </td>
                    <td
                      className={`py-1.5 pr-3 text-right ${
                        corner.apexSpeedDelta > 0
                          ? "text-success"
                          : corner.apexSpeedDelta < 0
                            ? "text-danger"
                            : "text-muted"
                      }`}
                    >
                      {signed(corner.apexSpeedDelta, 0, " km/h")}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {corner.brakeDeltaM === null ? "—" : signed(corner.brakeDeltaM, 0, " m")}
                    </td>
                    <td
                      className={`py-1.5 pr-3 text-right ${
                        corner.exitSpeedDelta > 0
                          ? "text-success"
                          : corner.exitSpeedDelta < 0
                            ? "text-danger"
                            : "text-muted"
                      }`}
                    >
                      {signed(corner.exitSpeedDelta, 0, " km/h")}
                    </td>
                    <td
                      className={`py-1.5 text-right ${
                        corner.timeDeltaMs === null
                          ? "text-muted"
                          : corner.timeDeltaMs > 0
                            ? "text-danger"
                            : "text-success"
                      }`}
                    >
                      {corner.timeDeltaMs === null ? "—" : seconds(corner.timeDeltaMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Corner positions come from FastF1&apos;s curated corner database, not from
            curvature — the position channel is too coarse to find corners (see
            `analysis/lateral_accel.py`). Apex speed is the lowest speed in the corner's own
            stretch of lap, capped at 80 m around its marker, so neighbouring corners never
            report the same minimum. Brake is how much later (+) or earlier (−) {b.label} got
            on the brakes; a corner taken flat out has no braking point and shows a dash. At
            one sample every ~{Math.round(built.sampleIntervalMs)} ms, a few km/h or a couple
            of metres is below the resolution of this data.
          </p>
        </div>
      ) : null}

      <dl className="grid gap-4 border-t border-line pt-4 sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-widest text-muted">
            {a.label} lap
          </dt>
          <dd className="font-mono text-lg tabular-nums">{formatLapTime(a.lap.lapTimeMs)}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-widest text-muted">
            {b.label} lap
          </dt>
          <dd className="font-mono text-lg tabular-nums">{formatLapTime(b.lap.lapTimeMs)}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-widest text-muted">
            Official gap
          </dt>
          <dd
            className={`font-mono text-lg tabular-nums ${
              officialGapMs > 0 ? "text-danger" : "text-success"
            }`}
          >
            {seconds(officialGapMs)}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-widest text-muted">
            Trace ends @ {(built.endDistanceM / 1000).toFixed(2)} km
          </dt>
          <dd className="font-mono text-lg tabular-nums text-muted">
            {seconds(built.totalDeltaMs)}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-widest text-muted">
            Biggest swing
          </dt>
          <dd className="font-mono text-sm tabular-nums">
            <span className="text-success">
              {seconds(built.biggestGainMs)} @ {(built.biggestGainAtM / 1000).toFixed(2)} km
            </span>
            <br />
            <span className="text-danger">
              {seconds(built.biggestLossMs)} @ {(built.biggestLossAtM / 1000).toFixed(2)} km
            </span>
          </dd>
        </div>
      </dl>
      <p className="text-xs leading-relaxed text-muted">
        The official gap comes from the timing data and is exact. The trace is built from
        telemetry sampled every ~{Math.round(built.sampleIntervalMs)} ms, and a lap window
        cannot land exactly on the line crossing, so the gap on the trace at its last point
        differs from the official figure by up to roughly one sample. Read the trace for
        where the time moves, not for its end value.
      </p>
    </div>
  );
}
