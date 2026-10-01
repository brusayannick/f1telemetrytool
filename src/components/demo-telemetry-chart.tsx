"use client";

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

const HEIGHT = 220;

function buildData(): uPlot.AlignedData {
  const n = 1200;
  const distance: number[] = [];
  const speed: number[] = [];
  const throttle: number[] = [];

  for (let i = 0; i < n; i += 1) {
    const x = i / (n - 1);
    const wave =
      Math.sin(x * Math.PI * 8) * 0.5 + Math.sin(x * Math.PI * 17 + 1.2) * 0.25;
    distance.push(Math.round(x * 5800));
    speed.push(Math.round(165 + wave * 75 + (x > 0.82 ? 85 : 0)));
    throttle.push(
      Math.round(
        Math.max(0, Math.min(100, 55 + Math.sin(x * Math.PI * 6.5 + 0.4) * 55)),
      ),
    );
  }

  return [distance, speed, throttle];
}

export function DemoTelemetryChart() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const opts: uPlot.Options = {
      width: container.clientWidth,
      height: HEIGHT,
      padding: [12, 12, 0, 0],
      cursor: { show: true, x: true, y: false, points: { show: false } },
      legend: { show: false },
      scales: { x: { time: false }, y: { range: [0, 340] } },
      axes: [
        {
          stroke: "#5c5f66",
          grid: { stroke: "#e7e8ea" },
          ticks: { stroke: "#e7e8ea" },
          font: "11px 'IBM Plex Mono', ui-monospace, monospace",
          values: (_self, ticks) => ticks.map((tick) => `${Math.round(tick)} m`),
        },
        {
          stroke: "#5c5f66",
          grid: { stroke: "#e7e8ea" },
          ticks: { stroke: "#e7e8ea" },
          font: "11px 'IBM Plex Mono', ui-monospace, monospace",
        },
      ],
      series: [
        {},
        {
          label: "Speed",
          stroke: "#005f73",
          width: 2,
          fill: "rgba(0, 95, 115, 0.08)",
        },
        { label: "Throttle", stroke: "#2b8a3e", width: 1.5 },
      ],
    };

    const chart = new uPlot(opts, buildData(), container);

    const onResize = () => {
      chart.setSize({ width: container.clientWidth, height: HEIGHT });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.destroy();
    };
  }, []);

  return <div ref={containerRef} className="w-full" />;
}
