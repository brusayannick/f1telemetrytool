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
  /**
   * Labels of corners whose territory this segment swallowed.
   *
   * A corner is dropped when its exit resolves to a sample at or behind the cursor: two
   * corners sharing one full-throttle point (Abu Dhabi's T6/T7 are 63 m apart), or two
   * markers in the last 150 m both clamping to the trace end. Its braking zone and apex
   * then sit inside this — the previously emitted — segment, which keeps `verified: true`
   * and would otherwise read as an ordinary corner. Measured consequence: a matrix column
   * showed a 2,082 ms "loss" that does not exist in the telemetry (B17).
   *
   * Any consumer comparing segments across laps must treat a non-empty list as "this is
   * more than the corner it is named after", not as a time for that corner.
   */
  absorbed: string[];
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

  /**
   * A straight is named after the corner it leads into, not by its position in the lap.
   *
   * An ordinal was wrong the moment two laps were compared: the edge-minimum rule drops a
   * different set of corners on each lap (B4), so a lap that loses one corner merges two
   * straights into one and every later ordinal shifts down by one. `S3` then meant a short
   * straight on one lap and a straight that had swallowed a whole corner and its braking
   * zone on another — which is what the segment matrix compared against each other (B17).
   * "The run into T8" is the same piece of track on every lap, whether or not T7 was
   * confirmed on the way there.
   */
  const pushStraight = (from: number, to: number, intoLabel = "END") => {
    if (to - from <= 0) return;
    segments.push({
      label: `→${intoLabel}`,
      kind: "straight",
      fromM: from,
      toM: to,
      timeMs: elapsed(series, to) - elapsed(series, from),
      apexM: null,
      apexSpeed: null,
      brakeFromM: null,
      exitM: null,
      verified: true,
      absorbed: [],
    });
  };

  for (const performance of performances) {
    // A corner's braking zone can reach back into the previous segment, so the window is
    // clipped to start where the last one ended. Without this the times would overlap and
    // the sum would exceed the lap.
    const windowFrom = performance.brakeDist ?? performance.apexDist - LEAD_IN_M;
    const from = Math.max(cursor, windowFrom, startM);
    const to = Math.min(endM, Math.max(from, performance.exitDist));

    if (from > cursor) pushStraight(cursor, from, performance.label);
    if (to <= from) {
      // The corner's whole window lies at or behind the cursor, so the segment that was
      // already emitted contains it. Record that instead of letting the host segment look
      // like an ordinary corner of its own.
      const host = segments[segments.length - 1];
      if (host) host.absorbed.push(performance.label);
      continue;
    }

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
      absorbed: [],
    });

    cursor = to;
  }

  if (cursor < endM) pushStraight(cursor, endM);

  return segments;
}

/**
 * Total of the segment times.
 *
 * This must equal the telemetry span the segments tile — NOT the official lap time. The
 * telemetry window is short by up to a sample (measured 87–307 ms across four circuits),
 * so a correct decomposition still lands short of the timing figure.
 */
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
