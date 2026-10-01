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

/** Format a duration in milliseconds as m:ss.mmm. */
export function formatLapTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const minutes = Math.floor(ms / 60_000);
  const seconds = (ms % 60_000) / 1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}
