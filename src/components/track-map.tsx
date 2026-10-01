"use client";

import { useMemo } from "react";
import type { DeltaTrace, LapPosition } from "@/lib/telemetry";

const PAD = 24;
const BASE_STROKE = "#d9dcde";
const LOSS = "#c92a2a";
const GAIN = "#2b8a3e";

type Props = {
  position: LapPosition | null;
  /** Signed cumulative gap vs distance; positive means the other lap is behind. */
  delta?: DeltaTrace | null;
  baseLabel?: string;
  otherLabel?: string;
  /** Only colour where the local swing exceeds this many milliseconds. */
  thresholdMs?: number;
  /** Distance over which the local swing is measured, in metres. */
  windowM?: number;
};

/**
 * Circuit outline with the time gain/loss hotspots painted onto it.
 *
 * The path comes from the reference lap's positional channel, and the colouring samples
 * the reference lap at each delta-grid distance so a segment lines up with the swing it
 * represents.
 */
export function TrackMap({
  position,
  delta,
  baseLabel = "A",
  otherLabel = "B",
  thresholdMs = 25,
  windowM = 120,
}: Props) {
  const view = useMemo(() => {
    if (!position || position.x.length < 2) return null;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < position.x.length; i += 1) {
      if (position.x[i] < minX) minX = position.x[i];
      if (position.x[i] > maxX) maxX = position.x[i];
      if (position.y[i] < minY) minY = position.y[i];
      if (position.y[i] > maxY) maxY = position.y[i];
    }

    const width = maxX - minX || 1;
    const height = maxY - minY || 1;
    // SVG's y axis grows downwards, so flip it to keep the circuit the right way up.
    const project = (x: number, y: number) => [x - minX, maxY - y] as const;

    const path = Array.from({ length: position.x.length }, (_, i) => {
      const [px, py] = project(position.x[i], position.y[i]);
      return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
    }).join(" ");

    return { width, height, path, project };
  }, [position]);

  const segments = useMemo(() => {
    if (!position || !delta || !view || delta.dist.length < 2) return [];

    // The cumulative delta is monotone for most of a lap (whoever is behind stays
    // behind), so colouring by it just paints the whole circuit one colour. The useful
    // signal is the *rate* of change: how much the gap moves over a short window, which
    // is what isolates the corners that actually decided the lap.
    const stepM = delta.dist[1] - delta.dist[0] || 10;
    const windowSteps = Math.max(1, Math.round(windowM / stepM));

    const out: { x1: number; y1: number; x2: number; y2: number; value: number }[] = [];
    let cursor = 0;

    for (let i = 1; i < delta.dist.length; i += 1) {
      const target = delta.dist[i];
      while (cursor < position.dist.length - 2 && position.dist[cursor + 1] < target) {
        cursor += 1;
      }

      const earlier = Math.max(0, i - windowSteps);
      const value = delta.delta[i] - delta.delta[earlier];
      if (Math.abs(value) < thresholdMs) continue;

      const [x1, y1] = view.project(position.x[cursor], position.y[cursor]);
      const [x2, y2] = view.project(position.x[cursor + 1], position.y[cursor + 1]);
      out.push({ x1, y1, x2, y2, value });
    }

    return out;
  }, [position, delta, view, thresholdMs, windowM]);

  if (!view || !position) {
    return <p className="py-6 text-sm text-muted">No positional data for this lap.</p>;
  }

  const [startX, startY] = view.project(position.x[0], position.y[0]);
  const maxSwing = Math.max(thresholdMs, ...segments.map((s) => Math.abs(s.value)));
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <svg
        viewBox={`${-PAD} ${-PAD} ${view.width + PAD * 2} ${view.height + PAD * 2}`}
        className="h-80 w-full max-w-sm shrink-0"
        role="img"
        aria-label="Circuit map with the areas of time gain and loss highlighted"
      >
        <path
          d={view.path}
          fill="none"
          stroke={BASE_STROKE}
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {segments.map((segment, index) => (
          <line
            key={index}
            x1={segment.x1}
            y1={segment.y1}
            x2={segment.x2}
            y2={segment.y2}
            stroke={segment.value > 0 ? LOSS : GAIN}
            strokeWidth={7}
            strokeLinecap="round"
            opacity={0.35 + (0.65 * Math.min(1, Math.abs(segment.value) / 400))}
          />
        ))}
        <circle cx={startX} cy={startY} r={4.5} fill="#0b0b0b" />
        <text x={startX + 10} y={startY + 4} fontSize={11} fill="#5c5f66" fontFamily="ui-monospace, monospace">
          S/F
        </text>
      </svg>

      <div className="space-y-2 text-xs leading-relaxed text-muted">
        <p className="font-mono text-[10px] uppercase tracking-widest">
          Track · {otherLabel} vs {baseLabel}
        </p>
        <p className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-6 rounded-full" style={{ backgroundColor: LOSS }} />
          {otherLabel} losing time
        </p>
        <p className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-6 rounded-full" style={{ backgroundColor: GAIN }} />
          {otherLabel} gaining time
        </p>
        <p className="max-w-xs pt-1">
          Local swing per {windowM} m: only movements beyond {thresholdMs} ms are drawn, at
          an opacity scaled to their size (up to {Math.round(maxSwing)} ms here). The grey
          line is {baseLabel}&apos;s path.
        </p>
      </div>
    </div>
  );
}
