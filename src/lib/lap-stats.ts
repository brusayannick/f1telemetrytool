import { AXES, seriesByKey } from "@/lib/channels";
import { lapRange, type LapInfo, type Telemetry } from "@/lib/telemetry";

/**
 * Per-lap channel statistics for whatever the workbench has on screen.
 *
 * Every number here comes from the same `values()` function the chart plots, so a figure
 * in the table can never disagree with the line drawn above it — including for derived
 * channels, which are computed by that function and not stored anywhere.
 */
export type ChannelStat = {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  mean: number;
  std: number;
  /** Distance from the lap start, in metres, where the extreme occurred. */
  minAtM: number;
  maxAtM: number;
  /** Share of samples above zero — pedal, DRS and warning-light duty. */
  dutyPct: number;
  /** Samples that carried no value: `ahead` is NaN for a leading car. */
  gaps: number;
};

export type LapStats = {
  stats: ChannelStat[];
  samples: number;
  distanceM: number;
  /** Median spacing between samples in ms — the resolution floor of all of the above. */
  medianStepMs: number;
  /** Largest spacing in ms: what a resampling pass would have to bridge. */
  maxStepMs: number;
};

export function lapStats(
  telemetry: Telemetry,
  lap: LapInfo,
  keys: string[],
): LapStats | null {
  const range = lapRange(telemetry, lap);
  if (!range) return null;

  const [start, end] = range;
  const size = end - start;
  const { dist, t } = telemetry.channels;
  const origin = dist[start];

  const stats: ChannelStat[] = [];

  for (const key of keys) {
    const spec = seriesByKey(key);
    if (!spec || !(spec.available?.(telemetry) ?? true)) continue;

    const values = spec.values(telemetry, start, end);

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    let sumSquares = 0;
    let count = 0;
    let above = 0;
    let gaps = 0;
    let minIndex = -1;
    let maxIndex = -1;

    for (let i = 0; i < size; i += 1) {
      const value = values[i];
      if (!Number.isFinite(value)) {
        gaps += 1;
        continue;
      }
      if (value < min) {
        min = value;
        minIndex = i;
      }
      if (value > max) {
        max = value;
        maxIndex = i;
      }
      sum += value;
      sumSquares += value * value;
      if (value > 0) above += 1;
      count += 1;
    }

    if (count === 0) continue;

    const mean = sum / count;
    // E[x²] − E[x]² in one pass; clamped because it can go slightly negative in float.
    const variance = Math.max(0, sumSquares / count - mean * mean);

    stats.push({
      key,
      label: spec.label,
      unit: AXES[spec.axis].label,
      min,
      max,
      mean,
      std: Math.sqrt(variance),
      minAtM: minIndex >= 0 ? dist[start + minIndex] - origin : 0,
      maxAtM: maxIndex >= 0 ? dist[start + maxIndex] - origin : 0,
      dutyPct: (above / count) * 100,
      gaps,
    });
  }

  const steps: number[] = [];
  for (let i = 1; i < size; i += 1) steps.push(t[start + i] - t[start + i - 1]);
  steps.sort((a, b) => a - b);

  return {
    stats,
    samples: size,
    distanceM: dist[end - 1] - origin,
    medianStepMs: steps.length > 0 ? steps[Math.floor(steps.length / 2)] : 0,
    maxStepMs: steps.length > 0 ? steps[steps.length - 1] : 0,
  };
}
