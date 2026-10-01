import { decode } from "@msgpack/msgpack";
import { gunzipSync } from "fflate";

export const TELEMETRY_CHANNELS = [
  "t", // ms since the first sample of this telemetry slice
  "dist", // metres
  "speed", // km/h
  "rpm",
  "gear",
  "thr", // 0-100 %
  "brk", // 0 or 100
  "drs", // 0-14
  "x",
  "y",
  "z",
] as const;

export type TelemetryChannel = (typeof TELEMETRY_CHANNELS)[number];

export type Telemetry = {
  n: number;
  /** Absolute session time (ms since session start) of sample 0. */
  t0ms: number;
  channels: Record<TelemetryChannel, Float32Array>;
};

type TelemetryPayload = {
  n: number;
  t0ms?: number;
  order?: TelemetryChannel[];
  channels: Record<string, Uint8Array>;
};

/** Download and decode one driver-session telemetry file (gzip + msgpack, float32le). */
export async function loadTelemetry(url: string): Promise<Telemetry> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch telemetry (${response.status})`);
  }

  const packed = decode(
    gunzipSync(new Uint8Array(await response.arrayBuffer())),
  ) as TelemetryPayload;

  const order = packed.order ?? [...TELEMETRY_CHANNELS];
  const channels = {} as Record<TelemetryChannel, Float32Array>;

  for (const name of order) {
    const bytes = packed.channels[name];
    if (!bytes) continue;
    // `slice()` copies into a fresh buffer: the decoded view may not be 4-byte
    // aligned, which Float32Array requires.
    channels[name] = new Float32Array(bytes.slice().buffer);
  }

  return { n: packed.n, t0ms: packed.t0ms ?? 0, channels };
}

function lowerBound(values: Float32Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export type LapInfo = {
  lapStartMs: number | null;
  lapTimeMs: number | null;
};

/**
 * Sample index range [start, end) covering one lap, or null when the lap has no
 * session time recorded. Lap times are session-relative, the telemetry slice is
 * relative to its own first sample — `t0ms` bridges the two.
 */
export function lapRange(
  telemetry: Telemetry,
  lap: LapInfo,
): [number, number] | null {
  if (lap.lapStartMs === null || lap.lapTimeMs === null) return null;

  const t = telemetry.channels.t;
  const from = lap.lapStartMs - telemetry.t0ms;
  const to = from + lap.lapTimeMs;

  const start = lowerBound(t, from);
  const end = lowerBound(t, to);
  return end > start ? [start, end] : null;
}

/** One lap's channels, indexed from the start of that lap. */
export type LapSeries = {
  dist: Float64Array; // metres since lap start
  time: Float64Array; // milliseconds since lap start
  speed: Float64Array;
  thr: Float64Array;
  brk: Float64Array;
};

/**
 * Extract one lap as distance/time-indexed channels.
 *
 * Times are rebased to the lap start, so two laps can be compared without knowing
 * anything about where they sat in the session.
 */
export function lapSeries(telemetry: Telemetry, lap: LapInfo): LapSeries | null {
  const range = lapRange(telemetry, lap);
  if (!range || lap.lapStartMs === null) return null;

  const [start, end] = range;
  const size = end - start;
  const { t, dist, speed, thr, brk } = telemetry.channels;

  const lapStart = lap.lapStartMs - telemetry.t0ms;
  const origin = dist[start];

  const series: LapSeries = {
    dist: new Float64Array(size),
    time: new Float64Array(size),
    speed: new Float64Array(size),
    thr: new Float64Array(size),
    brk: new Float64Array(size),
  };

  for (let i = 0; i < size; i += 1) {
    const j = start + i;
    series.dist[i] = dist[j] - origin;
    series.time[i] = t[j] - lapStart;
    series.speed[i] = speed[j];
    series.thr[i] = thr[j];
    series.brk[i] = brk[j];
  }

  return series;
}

/**
 * Resample a lap onto a uniform distance grid.
 *
 * Two laps of the same circuit have different sample spacing, so overlaying or
 * subtracting them first requires a shared abscissa.
 */
export function gridSeries(series: LapSeries, stepM = 10): LapSeries | null {
  const total = series.dist[series.dist.length - 1];
  if (!Number.isFinite(total) || total <= 0) return null;

  const count = Math.floor(total / stepM) + 1;
  const grid: LapSeries = {
    dist: new Float64Array(count),
    time: new Float64Array(count),
    speed: new Float64Array(count),
    thr: new Float64Array(count),
    brk: new Float64Array(count),
  };

  let cursor = 0;
  for (let i = 0; i < count; i += 1) {
    const target = i * stepM;
    // advance while the next sample is still before the target (cursor stays in range)
    while (cursor < series.dist.length - 2 && series.dist[cursor + 1] < target) {
      cursor += 1;
    }

    const dA = series.dist[cursor];
    const dB = series.dist[cursor + 1] ?? dA;
    const span = dB - dA;
    const w = span > 0 ? Math.min(1, Math.max(0, (target - dA) / span)) : 0;

    grid.dist[i] = target;
    grid.time[i] = series.time[cursor] + (series.time[cursor + 1] - series.time[cursor]) * w;
    grid.speed[i] = series.speed[cursor] + (series.speed[cursor + 1] - series.speed[cursor]) * w;
    grid.thr[i] = series.thr[cursor] + (series.thr[cursor + 1] - series.thr[cursor]) * w;
    grid.brk[i] = series.brk[cursor] + (series.brk[cursor + 1] - series.brk[cursor]) * w;
  }

  return grid;
}

export type DeltaTrace = {
  dist: Float64Array;
  /** Milliseconds behind (+) or ahead of (−) the reference lap at each distance. */
  delta: Float64Array;
};

/** Cumulative time difference between two laps already on a common grid. */
export function deltaTrace(base: LapSeries, other: LapSeries): DeltaTrace {
  const count = Math.min(base.dist.length, other.dist.length);
  const dist = new Float64Array(count);
  const delta = new Float64Array(count);

  for (let i = 0; i < count; i += 1) {
    dist[i] = base.dist[i];
    delta[i] = other.time[i] - base.time[i];
  }

  return { dist, delta };
}

/** Format a duration in milliseconds as m:ss.mmm. */
export function formatLapTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const minutes = Math.floor(ms / 60_000);
  const seconds = (ms % 60_000) / 1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}
