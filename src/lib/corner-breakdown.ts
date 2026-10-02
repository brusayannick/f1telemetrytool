import { cornerPerformance, type Corner, type CornerGroup } from "@/lib/corners";
import type { LapSeries } from "@/lib/telemetry";

/**
 * Splits a corner's measured time delta into the phases it happened in.
 *
 * This is a **model**, not a measurement, and it says so: the three phase contributions are
 * the actual time difference accumulated inside three named windows, and everything the
 * windows do not cover — the run in before the braking zone and the run out after the exit —
 * is reported separately as `otherMs`. The contributions are never scaled to make the sum
 * look tidy. `brakeMs + apexMs + exitMs + otherMs` equals the measured corner delta by
 * construction, so a large `otherMs` is a statement about the model, not about the driver.
 *
 * The integral is the honest way to attribute time over a distance: over each step the time
 * difference is `dx/vB − dx/vA`, so no assumption about "how much time a metre of braking
 * costs" is needed. A negative contribution means B was faster in that window.
 */
export type CornerBreakdown = {
  label: string;
  /** B losing (+) or gaining (−) time inside the braking phase, in ms. */
  brakeMs: number;
  /** The same, inside a window centred on the apex. */
  apexMs: number;
  /** The same, from the end of the apex window to the exit. */
  exitMs: number;
  /** The rest of the corner's measured delta: run-in and run-out. */
  otherMs: number;
  /** The measured corner delta this decomposes, in ms. */
  totalMs: number;
};

/** Integration step. 2 m is well below the ~30 m a sample covers at racing speed. */
const STEP_M = 2;
/** Half width of the apex window, centred on the apex distance. */
const APEX_HALF_WINDOW_M = 20;
/** How far before the apex the window opens when the driver never braked. */
const NO_BRAKE_LEAD_IN_M = 150;

/** Linear interpolation of the speed at a distance; clamps outside the range. */
function speedAt(series: LapSeries, atM: number): number {
  const { dist, speed } = series;
  const last = dist.length - 1;
  if (last < 0) return 0;
  if (atM <= dist[0]) return speed[0];
  if (atM >= dist[last]) return speed[last];

  let low = 0;
  let high = last;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (dist[mid] < atM) low = mid + 1;
    else high = mid;
  }

  const before = dist[low - 1];
  const after = dist[low];
  const span = after - before;
  const weight = span > 0 ? (atM - before) / span : 0;
  return speed[low - 1] + (speed[low] - speed[low - 1]) * weight;
}

/**
 * ∫ (1/v_B − 1/v_A) dx over a distance window, in milliseconds.
 *
 * Samples where either lap has no speed are skipped rather than treated as zero: a missing
 * value is not a slow car.
 */
function paceIntegralMs(
  a: LapSeries,
  b: LapSeries,
  fromM: number,
  toM: number,
): number {
  if (toM <= fromM) return 0;

  let sum = 0;
  for (let x = fromM; x < toM; x += STEP_M) {
    const dx = Math.min(STEP_M, toM - x);
    const va = speedAt(a, x) / 3.6;
    const vb = speedAt(b, x) / 3.6;
    if (va <= 0 || vb <= 0) continue;
    sum += (dx / vb - dx / va) * 1000;
  }
  return sum;
}

/**
 * Decompose every corner both laps have in common.
 *
 * `measuredByLabel` carries the corner deltas the corner table already computed, so this
 * function never produces its own idea of "the corner delta" — the decomposition and the
 * table cannot disagree about the total.
 */
export function cornerBreakdown(
  a: LapSeries,
  b: LapSeries,
  groups: Corner[] | CornerGroup[],
  measuredByLabel: Map<string, number>,
): CornerBreakdown[] {
  const performances = cornerPerformance(a, groups);

  return performances
    .filter((performance) => measuredByLabel.has(performance.label))
    .map((performance) => {
      const apex = performance.apexDist;
      const segmentFrom =
        performance.brakeDist ?? Math.max(a.dist[0], apex - NO_BRAKE_LEAD_IN_M);
      const segmentTo = performance.exitDist;

      // Three disjoint windows, so nothing is counted twice.
      const brakeMs = paceIntegralMs(a, b, segmentFrom, apex - APEX_HALF_WINDOW_M);
      const apexMs = paceIntegralMs(
        a,
        b,
        apex - APEX_HALF_WINDOW_M,
        apex + APEX_HALF_WINDOW_M,
      );
      const exitMs = paceIntegralMs(a, b, apex + APEX_HALF_WINDOW_M, segmentTo);

      const totalMs = measuredByLabel.get(performance.label) ?? 0;

      return {
        label: performance.label,
        brakeMs,
        apexMs,
        exitMs,
        // Whatever the three windows do not cover. Never rescaled.
        otherMs: totalMs - (brakeMs + apexMs + exitMs),
        totalMs,
      };
    });
}
