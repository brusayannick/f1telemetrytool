import type { DeltaTrace, LapSeries } from "@/lib/telemetry";

/**
 * Per-corner comparison, built on FastF1's curated corner database — with a data-driven
 * fallback when the database is wrong or missing.
 *
 * Corners are deliberately *not* detected from path curvature. Measured against 2025 Abu
 * Dhabi qualifying (`analysis/lateral_accel.py`), the position channel's first derivative
 * already carries outliers up to twice the car's real speed, so a curvature-based corner
 * detector would mostly find that noise. The database gives the corner's distance along
 * the lap, which is all this needs — everything else here is first order (distance, speed,
 * pedals) and therefore trustworthy.
 *
 * But the database is not infallible: Abu Dhabi's T11 marker sits ~130 m early, in the
 * middle of a flat-out straight (both drivers at 283 km/h, no braking), while the real
 * corner — the T12 hairpin — is at 4323 m. So every database corner is validated against
 * the lap itself: a corner whose stretch contains no braking at all is reported as
 * unverified rather than as a measurement. And when there is no database at all (older
 * seasons, missing circuit data), corners are found from the speed profile instead —
 * every braking zone implies a corner.
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
  /**
   * Whether the lap itself confirms this corner.
   *
   * A database marker with no braking anywhere in its stretch is either a flat-out kink
   * or a misplaced marker (Abu Dhabi T11 sits 130 m early, mid-straight, both drivers at
   * 283 km/h). Either way there is nothing to compare, so the row is marked unverified
   * instead of reporting a minimum that belongs to a neighbouring corner. A corner whose
   * minimum sits on the edge of a still-falling profile is skipped outright — that
   * minimum is the run into the next corner, not this one.
   */
  verified: boolean;
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
  /** False when neither lap braked in this stretch — the row is not a measurement. */
  verified: boolean;
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
  corners: Corner[] | CornerGroup[],
): CornerPerformance[] {
  const out: CornerPerformance[] = [];
  // Database corners carry numbers; detected ones are already groups.
  const list: CornerGroup[] =
    corners.length > 0 && "number" in corners[0]
      ? cornerGroups(corners as Corner[])
      : (corners as CornerGroup[]);

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

    // A minimum on the edge of a still-falling profile is not this corner's apex — it is
    // the run into the next corner's braking zone (Abu Dhabi T11's stretch ends at 4258 m
    // with the speed still falling toward the T12 hairpin). Only an interior minimum, or
    // one where the speed has actually bottomed out, counts.
    const atEdge = apex === apexTo - 1;
    const stillFalling =
      atEdge && apex > apexFrom && series.speed[apex] < series.speed[apex - 1];
    if (stillFalling) continue;

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

    // Validation against the lap itself: a corner with no braking anywhere in its own
    // stretch is either flat out or its marker is misplaced (Abu Dhabi T11). The minimum
    // found there belongs to a neighbour's braking zone, so it must not be reported as
    // this corner's apex.
    let verified = brakeDist !== null;
    if (!verified) {
      for (let i = apexFrom; i < apexTo; i += 1) {
        if (series.brk[i] > 0) {
          verified = true;
          break;
        }
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
      verified,
    });
  }

  return out;
}

/**
 * Find corners from the speed profile alone — the fallback when no database exists.
 *
 * Every braking zone implies a corner: the apex is the speed minimum after the zone ends,
 * and the corner's position is that minimum. Zones closer together than this are one
 * complex (the in-lap equivalent of the T6/T7 midpoint rule), and a zone must actually
 * slow the car — coasting or a dab of brake on a straight is not a corner.
 */
const DETECT_MERGE_M = 120;
const DETECT_MIN_DROP_KMH = 15;

export function detectCorners(series: LapSeries): CornerGroup[] {
  type Zone = { start: number; end: number };
  const zones: Zone[] = [];

  // Collect contiguous braking samples into zones.
  let open: number | null = null;
  for (let i = 0; i < series.dist.length; i += 1) {
    if (series.brk[i] > 0) {
      if (open === null) open = i;
    } else if (open !== null) {
      zones.push({ start: open, end: i - 1 });
      open = null;
    }
  }
  if (open !== null) zones.push({ start: open, end: series.dist.length - 1 });

  // Merge zones that belong to one complex, then keep only zones that slow the car.
  const merged: Zone[] = [];
  for (const zone of zones) {
    const last = merged[merged.length - 1];
    if (last && series.dist[zone.start] - series.dist[last.end] < DETECT_MERGE_M) {
      last.end = zone.end;
    } else {
      merged.push({ ...zone });
    }
  }

  const groups: CornerGroup[] = [];
  let index = 0;
  for (const zone of merged) {
    // The apex is the minimum between the zone's end and the next zone's start (or the
    // end of the lap) — the driver may still be slowing after releasing the brake.
    const next = merged[merged.indexOf(zone) + 1];
    const limit = next ? next.start : series.dist.length - 1;
    let apex = zone.end;
    for (let i = zone.end; i <= limit; i += 1) {
      if (series.speed[i] < series.speed[apex]) apex = i;
    }

    const before = series.speed[zone.start];
    if (before - series.speed[apex] < DETECT_MIN_DROP_KMH) continue;

    index += 1;
    groups.push({ label: `C${index}`, distance: series.dist[apex] });
  }

  return groups;
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
 * Both performances must come from the same corner list, so they are matched by label —
 * not by position. Either lap may skip a corner (a minimum on the edge of a still-falling
 * profile belongs to the next corner), and pairing by index would silently shift every
 * later row onto the wrong corner.
 */
export function cornerDeltas(
  a: CornerPerformance[],
  b: CornerPerformance[],
  trace: DeltaTrace | null,
): CornerDelta[] {
  const rightByLabel = new Map(b.map((perf) => [perf.label, perf]));
  const out: CornerDelta[] = [];

  // The table asks what this corner cost, so the time figure is the delta *accumulated
  // through* the corner: from where the previous corner ended to this corner's exit.
  //
  // Reading the trace at the apex instead — which is what this used to do — reports the
  // running total from the start of the lap. That makes every corner after an earlier
  // mistake look bad for a reason that happened somewhere else, and it cannot be
  // decomposed into phases, because the phases cover a window and the total covers the
  // lap. The increments tile the lap, so they still add up to the lap total.
  let previousExit = 0;

  // A corner can report the *previous* corner's braking point: `cornerPerformance` looks
  // back up to 400 m for a braking run and that window is not clamped at the neighbouring
  // corner's midpoint, so two apexes inside one continuous braking run resolve to the same
  // `brakeDist` (B21). Identical values on adjacent corners is the detectable signal. A
  // delta built from it would credit this corner with a braking difference that happened in
  // the one before it — and the ranking below turns that into a sentence with a verdict.
  const inheritedBrakeLabels = (list: CornerPerformance[]): Set<string> => {
    const inherited = new Set<string>();
    for (let i = 1; i < list.length; i += 1) {
      const current = list[i];
      const previous = list[i - 1];
      if (
        current.brakeDist !== null &&
        previous.brakeDist !== null &&
        current.brakeDist === previous.brakeDist
      ) {
        inherited.add(current.label);
      }
    }
    return inherited;
  };

  const inheritedA = inheritedBrakeLabels(a);
  const inheritedB = inheritedBrakeLabels(b);

  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const next = a[index + 1];
    const right = rightByLabel.get(left.label);
    if (!right) continue;
    const brakeDeltaM =
      left.brakeDist === null ||
      right.brakeDist === null ||
      inheritedA.has(left.label) ||
      inheritedB.has(right.label)
        ? null
        : right.brakeDist - left.brakeDist;

    const fromM = previousExit;
    // The exit lookahead can reach past the next corner, which would make two neighbouring
    // windows overlap and the increments sum to more than the lap. The bound is the midpoint
    // to the next corner — the same rule the apex window uses, and symmetric, so a pair of
    // corners 63 m apart (Abu Dhabi T6/T7) each keep half the gap instead of one losing its
    // whole window to the other's braking zone.
    const toM = next
      ? Math.min(left.exitDist, (left.apexDist + next.apexDist) / 2)
      : left.exitDist;
    // A missing sample gives null rather than a fake zero: an absent value is not a
    // corner that cost nothing.
    let timeDeltaMs: number | null = null;
    if (trace) {
      const atEnd = sampleAt(trace.dist, trace.delta, toM);
      const atStart = sampleAt(trace.dist, trace.delta, fromM);
      timeDeltaMs = atEnd !== null && atStart !== null ? atEnd - atStart : null;
    }
    // Only advance for corners we emit: a corner missing from either lap has its stretch
    // absorbed by the next one, so nothing falls out of the tiling.
    previousExit = toM;

    out.push({
      label: left.label,
      distance: left.apexDist,
      apexSpeedA: left.apexSpeed,
      apexSpeedB: right.apexSpeed,
      apexSpeedDelta: right.apexSpeed - left.apexSpeed,
      brakeDeltaM,
      exitSpeedDelta: right.exitSpeed - left.exitSpeed,
      timeDeltaMs,
      verified: left.verified && right.verified,
    });
  }

  return out;
}
