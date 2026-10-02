import {
  cornerGroups,
  cornerPerformance,
  detectCorners,
  type Corner,
} from "@/lib/corners";
import type { LapSeries } from "@/lib/telemetry";

/**
 * The lap, split into corner segments and the straights between them.
 *
 * This is the shared decomposition the plan calls for: segment times, the corner table and
 * the Δt attribution all read from here, so they cannot disagree about where a corner
 * starts. Boundaries come from `cornerPerformance`, which is already validated against the
 * lap — a corner whose speed minimum sits on the edge of a still-falling profile is skipped
 * rather than reported with a neighbour's minimum.
 *
 * The segments tile the lap: every metre belongs to exactly one segment, none overlap, and
 * the times therefore sum to the lap time.
 */
export type LapSegment = {
  label: string;
  kind: "corner" | "straight";
  fromM: number;
  toM: number;
  timeMs: number;
  /** Distance where the speed bottoms out; null for a straight. */
  apexM: number | null;
  apexSpeed: number | null;
  /** Where braking for this corner started, or null if the driver never braked. */
  brakeFromM: number | null;
  exitM: number | null;
  /** False when the lap could not confirm this corner (see `cornerPerformance`). */
  verified: boolean;
};

/**
 * How far before the apex a corner's window opens when the driver never braked.
 *
 * A flat-out kink has no braking zone to anchor on, so the window is centred on the apex
 * instead. 150 m is roughly two samples of a fast corner at 250 km/h.
 */
const LEAD_IN_M = 150;

/** Linear interpolation of a value at a distance; clamps outside the range. */
function valueAt(dist: Float64Array, values: Float64Array, target: number): number {
  const last = dist.length - 1;
  if (last < 0) return 0;
  if (target <= dist[0]) return values[0];
  if (target >= dist[last]) return values[last];

  let low = 0;
  let high = last;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (dist[mid] < target) low = mid + 1;
    else high = mid;
  }

  const before = dist[low - 1];
  const after = dist[low];
  const span = after - before;
  const weight = span > 0 ? (target - before) / span : 0;
  return values[low - 1] + (values[low] - values[low - 1]) * weight;
}

function elapsed(series: LapSeries, atM: number): number {
  return valueAt(series.dist, series.time, atM);
}

export function buildSegments(
  series: LapSeries,
  corners: Corner[] | null,
): LapSegment[] {
  const groups = corners && corners.length > 0 ? corners : detectCorners(series);
  if (groups.length === 0) return [];

  const performances = cornerPerformance(series, groups);
  if (performances.length === 0) return [];

  const startM = series.dist[0];
  const endM = series.dist[series.dist.length - 1];

  const segments: LapSegment[] = [];
  let cursor = startM;
  let straightIndex = 0;

  const pushStraight = (from: number, to: number) => {
    if (to - from <= 0) return;
    straightIndex += 1;
    segments.push({
      label: `S${straightIndex}`,
      kind: "straight",
      fromM: from,
      toM: to,
      timeMs: elapsed(series, to) - elapsed(series, from),
      apexM: null,
      apexSpeed: null,
      brakeFromM: null,
      exitM: null,
      verified: true,
    });
  };

  for (const performance of performances) {
    // A corner's braking zone can reach back into the previous segment, so the window is
    // clipped to start where the last one ended. Without this the times would overlap and
    // the sum would exceed the lap.
    const windowFrom = performance.brakeDist ?? performance.apexDist - LEAD_IN_M;
    const from = Math.max(cursor, windowFrom, startM);
    const to = Math.min(endM, Math.max(from, performance.exitDist));

    if (from > cursor) pushStraight(cursor, from);
    if (to <= from) continue;

    segments.push({
      label: performance.label,
      kind: "corner",
      fromM: from,
      toM: to,
      timeMs: elapsed(series, to) - elapsed(series, from),
      apexM: performance.apexDist,
      apexSpeed: performance.apexSpeed,
      brakeFromM: performance.brakeDist,
      exitM: performance.exitDist,
      verified: performance.verified,
    });

    cursor = to;
  }

  if (cursor < endM) pushStraight(cursor, endM);

  return segments;
}

/** Total of the segment times — must equal the lap time for the decomposition to be sound. */
export function segmentTotalMs(segments: LapSegment[]): number {
  let total = 0;
  for (const segment of segments) total += segment.timeMs;
  return total;
}

/** Corner-only view, in lap order — what the corner table and Δt attribution consume. */
export function cornerSegments(segments: LapSegment[]): LapSegment[] {
  return segments.filter((segment) => segment.kind === "corner");
}

/**
 * Corner positions for the annotation lines — every corner in the database, not only the
 * ones the lap could confirm.
 *
 * A marker is a location, not a measurement, so it is drawn even for a corner whose apex
 * could not be established inside its own stretch. The corner table stays strict and omits
 * those corners, and the difference between the two counts is reported rather than hidden:
 * drawing a line at a corner is honest, quoting a speed that belongs to the next corner is
 * not.
 */
export function annotationMarks(series: LapSeries, corners: Corner[] | null): number[] {
  const groups = corners && corners.length > 0 ? cornerGroups(corners) : detectCorners(series);
  return groups.map((group) => group.distance);
}
