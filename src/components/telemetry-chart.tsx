"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { lapRange, loadTelemetry, type Telemetry } from "@/lib/telemetry";
import { AXES, SERIES } from "@/lib/channels";
import { SkeletonChart } from "@/components/skeleton";

const HEIGHT = 260;

/** What is plotted before the user changes anything. */
const DEFAULT_SERIES = ["speed", "throttle", "brake"];

const AXIS_STYLE = {
  stroke: "#5c5f66",
  ticks: { stroke: "#e7e8ea" },
  font: "11px 'IBM Plex Mono', ui-monospace, monospace",
};

export type ChartLap = {
  lapNumber: number;
  lapStartMs: number | null;
  lapTimeMs: number | null;
};

type Props = {
  url: string;
  lap: ChartLap | null;
};

export function TelemetryChart({ url, lap }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(DEFAULT_SERIES);

  useEffect(() => {
    let cancelled = false;
    setTelemetry(null);
    setError(null);

    loadTelemetry(url)
      .then((data) => {
        if (!cancelled) setTelemetry(data);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  const chart = useMemo(() => {
    if (!telemetry || !lap) return null;

    const range = lapRange(telemetry, lap);
    if (!range) return null;

    const [start, end] = range;
    const size = end - start;
    const { dist } = telemetry.channels;

    const x = new Float64Array(size);
    const origin = dist[start];
    for (let i = 0; i < size; i += 1) {
      x[i] = dist[start + i] - origin;
    }

    // Only the selected series are evaluated, so a derived channel nobody asked for
    // costs nothing.
    const active = SERIES.filter((spec) => selected.includes(spec.key));
    const data: uPlot.AlignedData = [
      x,
      ...active.map((spec) => spec.values(telemetry, start, end)),
    ];

    return { data, active };
  }, [telemetry, lap, selected]);

  const toggle = (key: string) => {
    setSelected((current) => {
      if (current.includes(key)) {
        // never leave the chart with nothing on it
        return current.length === 1 ? current : current.filter((item) => item !== key);
      }
      return [...current, key];
    });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !chart) return;

    // One axis per scale actually in use, so adding RPM a while later does not crowd
    // the chart with empty axes.
    const usedAxes = Array.from(new Set(chart.active.map((spec) => spec.axis)));
    const scales: uPlot.Scales = { x: { time: false } };
    for (const key of usedAxes) {
      scales[key] = { range: AXES[key].range };
    }

    const axes: uPlot.Axis[] = [
      {
        ...AXIS_STYLE,
        grid: { stroke: "#e7e8ea" },
        values: (_self, ticks) => ticks.map((tick) => `${(tick / 1000).toFixed(1)} km`),
      },
      ...usedAxes.map((key) => ({
        ...AXIS_STYLE,
        scale: key,
        side: AXES[key].side,
        grid: { show: false },
        label: AXES[key].label,
        labelSize: 18,
        labelFont: "10px 'IBM Plex Mono', ui-monospace, monospace",
      })),
    ];

    const options: uPlot.Options = {
      width: container.clientWidth,
      height: HEIGHT,
      padding: [12, 12, 0, 0],
      cursor: { show: true, x: true, y: false, points: { show: false }, sync: { key: "f1-telemetry" } },
      legend: { show: true, live: false },
      scales,
      axes,
      series: [
        {},
        ...chart.active.map((spec) => ({
          label: spec.label,
          scale: spec.axis,
          stroke: spec.color,
          width: spec.width ?? 1.5,
          dash: spec.dash,
          fill: spec.fill,
        })),
      ],
    };

    const plot = new uPlot(options, chart.data, container);

    const onResize = () => {
      plot.setSize({ width: container.clientWidth, height: HEIGHT });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      plot.destroy();
    };
  }, [chart]);

  if (error) {
    return <p className="py-6 text-sm text-danger">Telemetry unavailable: {error}</p>;
  }

  if (!lap) {
    return <p className="py-6 text-sm text-muted">Select a lap to plot telemetry.</p>;
  }

  if (!chart) {
    return <SkeletonChart height={HEIGHT} />;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {SERIES.map((spec) => {
          const on = selected.includes(spec.key);
          return (
            <button
              key={spec.key}
              type="button"
              onClick={() => toggle(spec.key)}
              title={spec.note}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                on
                  ? "border-line bg-paper text-ink"
                  : "border-line bg-canvas text-muted hover:text-ink"
              }`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: on ? spec.color : "#c9ccd0" }}
              />
              {spec.label}
              {spec.kind === "derived" && <span className="text-muted">*</span>}
            </button>
          );
        })}
      </div>
      <div ref={containerRef} className="w-full" />
      <p className="text-[11px] leading-relaxed text-muted">
        * computed here rather than stored. Steering angle is not in the F1 feed — yaw
        rate comes from the car&apos;s path as a proxy.
      </p>
    </div>
  );
}
