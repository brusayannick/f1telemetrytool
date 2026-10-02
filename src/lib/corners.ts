import type { DeltaTrace, LapSeries } from "@/lib/telemetry";

/**
 * Per-corner comparison, built on FastF1's curated corner database.
 *
 * Corners are deliberately *not* detected from path curvature. Measured against 2025 Abu
 * Dhabi qualifying (`analysis/lateral_accel.py`), the position channel's first derivative
 * already carries outliers up to twice the car's real speed, so a curvature-based corner
 * detector would mostly find that noise. The database gives the corner's distance along
 * the lap, which is all this needs — everything else here is first order (distance, speed,
 * pedals) and therefore trustworthy.
 */

/** A corner as stored on the event: where it is along the lap, plus its geometry. */
export type Corner = {
  number: number;
  letter?: string;
  x: number;
  y: number;
  angle: number;
  distance: number;
};

/** What one driver did at one corner. */
export type CornerPerformance = {
  label: string;
  /** Where the minimum speed actually was — usually within a few metres of `distance`. */
  apexDist: number;
  apexSpeed: number; // km/h
  /** Where the braking for this corner started, or null if the driver never braked. */
  brakeDist: number | null;
  exitDist: number;
  exitSpeed: number; // km/h
};

/** Which corner, and how the two laps differ through it. Deltas are B relative to A. */
export type CornerDelta = {
  label: string;
  distance: number;
  apexSpeedA: number;
  apexSpeedB: number;
  apexSpeedDelta: number; // km/h, positive = B is faster through the apex
  /** Metres of braking-point offset; positive = B braked later. Null if either did not. */
  brakeDeltaM: number | null;
  exitSpeedDelta: number; // km/h, positive = B carries more speed out
  /** Time difference at this corner from the delta trace; positive = B is behind. */
  timeDeltaMs: number | null;
};

/** How far either side of the database distance the real speed minimum may sit. */
const APEX_WINDOW_M = 80;
/** How far back from the apex braking is allowed to have started. */
const BRAKE_LOOKBACK_M = 400;
/** A braking zone that ended further than this before the apex belongs to another corner. */
const BRAKE_END_WINDOW_M = 200;
/** Where "exit speed" is read, measured from the apex. */
const EXIT_LOOKAHEAD_M = 150;
const THROTTLE_FULL = 95;

function lowerBound(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function cornerLabel(corner: Corner): string {
  return `T${corner.number}${corner.letter ?? ""}`;
}

/** One resolvable corner, or a group of corners too close to tell apart. */
export type CornerGroup = {
  label: string;
  distance: number;
};

/**
 * Corners this close together are one point in the database, so they are listed as one.
 *
 * Separation in general is not solved by merging: Abu Dhabi's T6 and T7 are 63 m apart and
 * both are real corners. It is solved by giving each corner its own stretch of lap — see
 * the midpoint bounds in `cornerPerformance`.
 */
const MERGE_WITHIN_M = 20;

export function cornerGroups(corners: Corner[]): CornerGroup[] {
  const groups: CornerGroup[] = [];

  for (const corner of corners) {
    const last = groups[groups.length - 1];
    if (last && corner.distance - last.distance < MERGE_WITHIN_M) {
      last.label = `${last.label}+${cornerLabel(corner)}`;
      last.distance = (last.distance + corner.distance) / 2;
      continue;
    }
    groups.push({ label: cornerLabel(corner), distance: corner.distance });
  }

  return groups;
}

/**
 * Read one lap through every corner.
 *
 * The apex is the true speed minimum inside a window around the database distance, not the
 * database distance itself — the corner marker sits at the apex in FastF1's data, but the
 * driver's line and the recorded minimum can differ by a few metres, and reporting a
 * number that is not actually the minimum would be misleading.
 */
export function cornerPerformance(
  series: LapSeries,
  corners: Corner[],
): CornerPerformance[] {
  const out: CornerPerformance[] = [];
  const list = cornerGroups(corners);

  for (let index = 0; index < list.length; index += 1) {
    const corner = list[index];
    const before = list[index - 1];
    const after = list[index + 1];

    // A corner owns the lap between the midpoints to its neighbours, capped at the window
    // size. Both bounds matter: without the cap, a corner in the middle of a long straight
    // would report a minimum from hundreds of metres away; without the midpoint, a pair of
    // corners 63 m apart (Abu Dhabi T6/T7) would both report the same minimum, as if the
    // driver's behaviour had been measured twice.
    const from = Math.max(
      corner.distance - APEX_WINDOW_M,
      before ? (before.distance + corner.distance) / 2 : Number.NEGATIVE_INFINITY,
    );
    const to = Math.min(
      corner.distance + APEX_WINDOW_M,
      after ? (corner.distance + after.distance) / 2 : Number.POSITIVE_INFINITY,
    );
    const apexFrom = lowerBound(series.dist, from);
    const apexTo = lowerBound(series.dist, to);

    let apex = -1;
    for (let i = apexFrom; i < apexTo; i += 1) {
      if (apex < 0 || series.speed[i] < series.speed[apex]) apex = i;
    }
    if (apex < 0) continue;

    // Braking runs *into* the apex, and the driver is usually off the brakes by the time
    // the speed bottoms out — so the first braking sample before the apex is the *end* of
    // the zone. Walk back through the zone from there to find where it started.
    const brakeFrom = lowerBound(
      series.dist,
      series.dist[apex] - BRAKE_LOOKBACK_M,
    );
    let brakeEnd = -1;
    for (let i = apex - 1; i >= brakeFrom; i -= 1) {
      if (series.brk[i] > 0) {
        brakeEnd = i;
        break;
      }
    }

    // A zone that ended long before this apex is the previous corner's, and a flat-out
    // kink must not inherit it.
    let brakeDist: number | null = null;
    if (brakeEnd >= 0 && series.dist[apex] - series.dist[brakeEnd] <= BRAKE_END_WINDOW_M) {
      brakeDist = series.dist[brakeEnd];
      for (let i = brakeEnd - 1; i >= brakeFrom; i -= 1) {
        if (series.brk[i] <= 0) break;
        brakeDist = series.dist[i];
      }
    }

    // Exit: the moment the driver is back to full throttle, or the end of the window if
    // they are still feeding it in (slow corners, dirty air).
    const exitTo = lowerBound(series.dist, series.dist[apex] + EXIT_LOOKAHEAD_M);
    let exit = Math.max(apex, exitTo - 1);
    for (let i = apex; i < exitTo; i += 1) {
      if (series.thr[i] >= THROTTLE_FULL) {
        exit = i;
        break;
      }
    }

    out.push({
      label: corner.label,
      apexDist: series.dist[apex],
      apexSpeed: series.speed[apex],
      brakeDist,
      exitDist: series.dist[exit],
      exitSpeed: series.speed[exit],
    });
  }

  return out;
}

/** Linear lookup in a distance-indexed trace; null outside its range. */
function sampleAt(dist: Float64Array, values: Float64Array, target: number): number | null {
  if (dist.length === 0 || target < dist[0] || target > dist[dist.length - 1]) {
    return null;
  }
  const index = lowerBound(dist, target);
  if (index <= 0) return values[0];
  if (index >= dist.length) return values[values.length - 1];

  const before = dist[index - 1];
  const after = dist[index];
  const span = after - before;
  const weight = span > 0 ? (target - before) / span : 0;
  return values[index - 1] + (values[index] - values[index - 1]) * weight;
}

/**
 * Pair two laps corner by corner.
 *
 * Both performances must come from the same corner list, so they are matched by position.
 */
export function cornerDeltas(
  a: CornerPerformance[],
  b: CornerPerformance[],
  trace: DeltaTrace | null,
): CornerDelta[] {
  const count = Math.min(a.length, b.length);
  const out: CornerDelta[] = [];

  for (let i = 0; i < count; i += 1) {
    const left = a[i];
    const right = b[i];
    const brakeDeltaM =
      left.brakeDist === null || right.brakeDist === null
        ? null
        : right.brakeDist - left.brakeDist;

    out.push({
      label: left.label,
      distance: left.apexDist,
      apexSpeedA: left.apexSpeed,
      apexSpeedB: right.apexSpeed,
      apexSpeedDelta: right.apexSpeed - left.apexSpeed,
      brakeDeltaM,
      exitSpeedDelta: right.exitSpeed - left.exitSpeed,
      timeDeltaMs: trace ? sampleAt(trace.dist, trace.delta, left.apexDist) : null,
    });
  }

  return out;
}
