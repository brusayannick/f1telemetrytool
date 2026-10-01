"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { lapRange, loadTelemetry, type Telemetry } from "@/lib/telemetry";

const HEIGHT = 260;

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

  const data = useMemo<uPlot.AlignedData | null>(() => {
    if (!telemetry || !lap) return null;

    const range = lapRange(telemetry, lap);
    if (!range) return null;

    const [start, end] = range;
    const size = end - start;
    const { dist, speed, thr, brk } = telemetry.channels;

    const x = new Float64Array(size);
    const speedValues = new Float64Array(size);
    const throttleValues = new Float64Array(size);
    const brakeValues = new Float64Array(size);

    const origin = dist[start];
    for (let i = 0; i < size; i += 1) {
      const sample = start + i;
      x[i] = dist[sample] - origin;
      speedValues[i] = speed[sample];
      throttleValues[i] = thr[sample];
      brakeValues[i] = brk[sample];
    }

    return [x, speedValues, throttleValues, brakeValues];
  }, [telemetry, lap]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !data) return;

    const options: uPlot.Options = {
      width: container.clientWidth,
      height: HEIGHT,
      padding: [12, 12, 0, 0],
      cursor: { show: true, x: true, y: false, points: { show: false }, sync: { key: "f1-telemetry" } },
      legend: { show: true, live: false },
      scales: {
        x: { time: false },
        y: { range: [0, 350] },
        y2: { range: [0, 100] },
      },
      axes: [
        {
          stroke: "#5c5f66",
          grid: { stroke: "#e7e8ea" },
          ticks: { stroke: "#e7e8ea" },
          font: "11px 'IBM Plex Mono', ui-monospace, monospace",
          values: (_self, ticks) => ticks.map((tick) => `${(tick / 1000).toFixed(1)} km`),
        },
        {
          scale: "y",
          stroke: "#5c5f66",
          grid: { stroke: "#e7e8ea" },
          ticks: { stroke: "#e7e8ea" },
          font: "11px 'IBM Plex Mono', ui-monospace, monospace",
          label: "km/h",
          labelSize: 18,
          labelFont: "10px 'IBM Plex Mono', ui-monospace, monospace",
        },
        {
          scale: "y2",
          side: 1,
          stroke: "#5c5f66",
          grid: { show: false },
          ticks: { stroke: "#e7e8ea" },
          font: "11px 'IBM Plex Mono', ui-monospace, monospace",
          label: "%",
          labelSize: 18,
          labelFont: "10px 'IBM Plex Mono', ui-monospace, monospace",
        },
      ],
      series: [
        {},
        {
          label: "Speed",
          scale: "y",
          stroke: "#005f73",
          width: 2,
          fill: "rgba(0, 95, 115, 0.08)",
        },
        {
          label: "Throttle",
          scale: "y2",
          stroke: "#2b8a3e",
          width: 1.25,
        },
        {
          label: "Brake",
          scale: "y2",
          stroke: "#e03131",
          width: 1.25,
          fill: "rgba(224, 49, 49, 0.18)",
        },
      ],
    };

    const chart = new uPlot(options, data, container);

    const onResize = () => {
      chart.setSize({ width: container.clientWidth, height: HEIGHT });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.destroy();
    };
  }, [data]);

  if (error) {
    return <p className="py-6 text-sm text-danger">Telemetry unavailable: {error}</p>;
  }

  if (!lap) {
    return <p className="py-6 text-sm text-muted">Select a lap to plot telemetry.</p>;
  }

  if (!data) {
    return <p className="py-6 text-sm text-muted">Loading telemetry…</p>;
  }

  return <div ref={containerRef} className="w-full" />;
}
