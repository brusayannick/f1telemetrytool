import type { Telemetry } from "@/lib/telemetry";

/**
 * Every plottable telemetry series, whether it comes straight from the stored payload or
 * is computed here.
 *
 * Two things this registry is honest about:
 *
 * - **Steering angle does not exist in the F1 feed.** The car data carries speed, rpm,
 *   gear, throttle, brake and DRS, plus position. What can be shown instead is *yaw rate*
 *   derived from the path, which is a proxy for how much the car is rotating — useful,
 *   but not the steering wheel angle.
 * - **Derived series are labelled as such**, because a computed acceleration that looks
 *   authoritative is exactly the kind of number that misleads later.
 */
export type AxisKey = "speed" | "percent" | "rpm" | "gear" | "drs" | "accel" | "yaw";

export type AxisSpec = {
  range: [number, number];
  label: string;
  side: 0 | 1;
};

export const AXES: Record<AxisKey, AxisSpec> = {
  speed: { range: [0, 350], label: "km/h", side: 0 },
  percent: { range: [0, 100], label: "%", side: 1 },
  rpm: { range: [0, 15000], label: "rpm", side: 1 },
  gear: { range: [0, 8], label: "gear", side: 1 },
  drs: { range: [0, 14], label: "DRS", side: 1 },
  accel: { range: [-6, 6], label: "m/s²", side: 1 },
  yaw: { range: [-120, 120], label: "°/s", side: 1 },
};

export type SeriesSpec = {
  key: string;
  label: string;
  axis: AxisKey;
  color: string;
  width?: number;
  dash?: [number, number];
  fill?: string;
  kind: "stored" | "derived";
  /** Shown as a tooltip so the provenance of a line is never ambiguous. */
  note: string;
  values: (telemetry: Telemetry, start: number, end: number) => Float64Array;
};

function slice(channel: Float32Array, start: number, end: number): Float64Array {
  const out = new Float64Array(end - start);
  for (let i = 0; i < out.length; i += 1) out[i] = channel[start + i];
  return out;
}

/** Longitudinal acceleration in m/s² (central difference, so it stays symmetric). */
function acceleration(telemetry: Telemetry, start: number, end: number): Float64Array {
  const { t, speed } = telemetry.channels;
  const out = new Float64Array(end - start);
  for (let i = 0; i < out.length; i += 1) {
    const sample = start + i;
    const before = Math.max(start, sample - 1);
    const after = Math.min(end - 1, sample + 1);
    const dt = (t[after] - t[before]) / 1000;
    const dv = (speed[after] - speed[before]) / 3.6;
    out[i] = dt > 0 ? dv / dt : 0;
  }
  return out;
}

/** 100 while neither pedal is applied, else 0 — time spent coasting. */
function coasting(telemetry: Telemetry, start: number, end: number): Float64Array {
  const { thr, brk } = telemetry.channels;
  const out = new Float64Array(end - start);
  for (let i = 0; i < out.length; i += 1) {
    const sample = start + i;
    out[i] = thr[sample] < 2 && brk[sample] === 0 ? 100 : 0;
  }
  return out;
}

/** 100 while throttle and brake overlap, else 0 — trail braking. */
function trailBraking(telemetry: Telemetry, start: number, end: number): Float64Array {
  const { thr, brk } = telemetry.channels;
  const out = new Float64Array(end - start);
  for (let i = 0; i < out.length; i += 1) {
    const sample = start + i;
    out[i] = brk[sample] > 0 && thr[sample] > 5 ? 100 : 0;
  }
  return out;
}

/**
 * Yaw rate in °/s from the positional path — a *proxy* for steering input.
 *
 * Heading is measured over a short span to damp position noise, unwrapped across the
 * ±180° discontinuity, then differentiated and smoothed. Expect it to look coarse: the
 * position channel is sampled at ~7 Hz with occasional gaps.
 */
function yawRate(telemetry: Telemetry, start: number, end: number): Float64Array {
  const { t, x, y } = telemetry.channels;
  const size = end - start;
  const span = 2;

  const heading = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    const sample = start + i;
    const before = Math.max(start, sample - span);
    const after = Math.min(end - 1, sample + span);
    heading[i] = Math.atan2(y[after] - y[before], x[after] - x[before]);
  }

  const unwrapped = new Float64Array(size);
  unwrapped[0] = heading[0];
  for (let i = 1; i < size; i += 1) {
    let delta = heading[i] - heading[i - 1];
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    unwrapped[i] = unwrapped[i - 1] + delta;
  }

  const out = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    const before = Math.max(0, i - 2);
    const after = Math.min(size - 1, i + 2);
    const dt = (t[start + after] - t[start + before]) / 1000;
    out[i] =
      dt > 0 ? ((unwrapped[after] - unwrapped[before]) * 180) / Math.PI / dt : 0;
  }
  return out;
}

export const SERIES: SeriesSpec[] = [
  {
    key: "speed",
    label: "Speed",
    axis: "speed",
    color: "#005f73",
    width: 2,
    fill: "rgba(0, 95, 115, 0.08)",
    kind: "stored",
    note: "stored channel",
    values: (telemetry, start, end) => slice(telemetry.channels.speed, start, end),
  },
  {
    key: "throttle",
    label: "Throttle",
    axis: "percent",
    color: "#2b8a3e",
    width: 1.25,
    kind: "stored",
    note: "stored channel",
    values: (telemetry, start, end) => slice(telemetry.channels.thr, start, end),
  },
  {
    key: "brake",
    label: "Brake",
    axis: "percent",
    color: "#e03131",
    width: 1.25,
    fill: "rgba(224, 49, 49, 0.18)",
    kind: "stored",
    note: "stored channel",
    values: (telemetry, start, end) => slice(telemetry.channels.brk, start, end),
  },
  {
    key: "rpm",
    label: "RPM",
    axis: "rpm",
    color: "#e8590c",
    width: 1.25,
    kind: "stored",
    note: "stored channel",
    values: (telemetry, start, end) => slice(telemetry.channels.rpm, start, end),
  },
  {
    key: "gear",
    label: "Gear",
    axis: "gear",
    color: "#495057",
    width: 1.25,
    kind: "stored",
    note: "stored channel",
    values: (telemetry, start, end) => slice(telemetry.channels.gear, start, end),
  },
  {
    key: "drs",
    label: "DRS",
    axis: "drs",
    color: "#1098ad",
    width: 1.25,
    kind: "stored",
    note: "stored channel (0-14)",
    values: (telemetry, start, end) => slice(telemetry.channels.drs, start, end),
  },
  {
    key: "accel",
    label: "Acceleration",
    axis: "accel",
    color: "#7048e8",
    width: 1.5,
    kind: "derived",
    note: "derived: d(speed)/dt",
    values: acceleration,
  },
  {
    key: "coast",
    label: "Coasting",
    axis: "percent",
    color: "#b45309",
    width: 1.25,
    fill: "rgba(180, 83, 9, 0.15)",
    kind: "derived",
    note: "derived: no throttle and no brake",
    values: coasting,
  },
  {
    key: "trail",
    label: "Trail braking",
    axis: "percent",
    color: "#c2255c",
    width: 1.25,
    kind: "derived",
    note: "derived: brake and throttle overlapping",
    values: trailBraking,
  },
  {
    key: "yaw",
    label: "Yaw rate",
    axis: "yaw",
    color: "#0b7285",
    width: 1.25,
    kind: "derived",
    note: "derived from the path — a steering proxy, not steering angle",
    values: yawRate,
  },
];

export function seriesByKey(key: string): SeriesSpec | undefined {
  return SERIES.find((spec) => spec.key === key);
}
