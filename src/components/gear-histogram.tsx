"use client";

import { useEffect, useMemo, useState } from "react";
import { lapRange, loadTelemetry, type LapInfo, type Telemetry } from "@/lib/telemetry";

/** RPM bands are 1 000 rpm wide; the channel tops out around 12 000. */
const RPM_BAND = 1000;

export type GearLap = LapInfo & {
  lapNumber: number;
  isAccurate?: boolean | null;
  pitIn?: boolean | null;
  pitOut?: boolean | null;
};

type Props = {
  url: string;
  laps: GearLap[];
};

type Share = { key: string; ms: number; share: number };

const sec = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * F26 — gear and RPM time share.
 *
 * Where the lap's time actually goes: which gear the car spends it in, and which part of the
 * rev range. A trace shows the shape of a signal; this shows its budget, and "a third of the
 * lap in sixth gear" is a different statement from "the gear trace goes up and down".
 *
 * The acceptance criterion is the interesting part, and it is **checked rather than
 * claimed**: the time shares must sum to the lap's telemetry span within one sample. Each
 * sample's duration is attributed to the gear and band it was recorded in, so the shares
 * partition the same span the segment decomposition uses. The panel prints both numbers so a
 * reader can watch the partition hold instead of trusting it.
 *
 * A sample's duration is the gap to the *next* sample, so the last sample of a lap
 * contributes nothing — the same convention as the rest of the app, and the reason the check
 * is a tolerance rather than an equality.
 *
 * A sample whose gear or rpm is not finite is still counted in the attribution total but in
 * neither table, so the check would expose it rather than hide it.
 */
export function GearHistogram({ url, laps }: Props) {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setTelemetry(null);
    setFailed(false);
    loadTelemetry(url)
      .then((loaded) => {
        if (!cancelled) setTelemetry(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const data = useMemo(() => {
    if (!telemetry) {
      return {
        gears: [] as Share[],
        bands: [] as Share[],
        attributedMs: 0,
        spanMs: 0,
        counted: 0,
        noTiming: 0,
      };
    }

    const { t, gear, rpm } = telemetry.channels;
    const gearMs = new Map<number, number>();
    const bandMs = new Map<number, number>();
    let attributedMs = 0;
    let spanMs = 0;
    let counted = 0;
    let noTiming = 0;

    for (const lap of laps) {
      if (lap.isAccurate === false || lap.pitIn || lap.pitOut) continue;

      const range = lapRange(telemetry, lap);
      if (!range) {
        noTiming += 1;
        continue;
      }

      counted += 1;
      const [from, to] = range;
      spanMs += t[to - 1] - t[from];

      for (let i = from; i < to - 1; i += 1) {
        const dt = t[i + 1] - t[i];
        if (!Number.isFinite(dt) || dt <= 0) continue;
        attributedMs += dt;

        const g = gear[i];
        if (Number.isFinite(g)) {
          gearMs.set(g, (gearMs.get(g) ?? 0) + dt);
        }

        const r = rpm[i];
        if (Number.isFinite(r)) {
          const band = Math.floor(r / RPM_BAND) * RPM_BAND;
          bandMs.set(band, (bandMs.get(band) ?? 0) + dt);
        }
      }
    }

    const toShares = (map: Map<number, number>, format: (key: number) => string): Share[] =>
      [...map.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([key, ms]) => ({
          key: format(key),
          ms,
          share: attributedMs > 0 ? ms / attributedMs : 0,
        }));

    return {
      gears: toShares(gearMs, (key) => String(key)),
      bands: toShares(bandMs, (key) => `${key}–${key + RPM_BAND}`),
      attributedMs,
      spanMs,
      counted,
      noTiming,
    };
  }, [telemetry, laps]);

  if (failed) {
    return (
      <p className="font-mono text-[11px] text-danger">
        gear histogram: telemetry could not be loaded
      </p>
    );
  }

  if (!telemetry) {
    return <p className="font-mono text-[11px] text-muted">gear histogram: loading…</p>;
  }

  if (data.counted === 0) {
    return (
      <p className="font-mono text-[11px] text-muted">
        gear histogram: no countable lap in this file had a telemetry slice
      </p>
    );
  }

  const differenceMs = data.attributedMs - data.spanMs;
  const bar = (share: number) => (
    <span
      className="inline-block h-2 bg-accent-300 align-middle"
      style={{ width: `${Math.max(share * 120, 0)}px` }}
    />
  );

  const table = (title: string, unit: string, rows: Share[]) => (
    <div>
      <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
        {title}
      </h3>
      <table className="mt-1 w-full border-collapse font-mono text-[10px] tabular-nums">
        <thead>
          <tr className="text-muted">
            <th className="px-1 py-0.5 text-left font-normal">{unit}</th>
            <th className="px-1 py-0.5 text-right font-normal">share</th>
            <th className="px-1 py-0.5 text-right font-normal">time</th>
            <th className="px-1 py-0.5 text-left font-normal"> </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-line/50">
              <th scope="row" className="px-1 py-0.5 text-left font-normal text-ink">
                {row.key}
              </th>
              <td className="px-1 py-0.5 text-right">{(row.share * 100).toFixed(1)} %</td>
              <td className="px-1 py-0.5 text-right text-muted">
                {sec.format(row.ms / 1000)} s
              </td>
              <td className="px-1 py-0.5 text-left">{bar(row.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <section className="mt-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
          gear and rpm
        </h2>
        <span className="font-mono text-[10px] text-muted">
          {data.counted} countable laps · {RPM_BAND} rpm bands
        </span>
        <span
          className={`font-mono text-[10px] ${
            Math.abs(differenceMs) < 200 ? "text-muted" : "text-warning"
          }`}
        >
          attribution: {sec.format(data.attributedMs / 1000)} s of{" "}
          {sec.format(data.spanMs / 1000)} s span ({differenceMs >= 0 ? "+" : "−"}
          {Math.abs(Math.round(differenceMs))} ms, tolerance one sample)
        </span>
      </header>

      <div className="mt-3 grid grid-cols-1 gap-6 md:grid-cols-2">
        {table("time per gear", "gear", data.gears)}
        {table("time per rpm band", "rpm", data.bands)}
      </div>

      <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted">
        Each sample&rsquo;s duration is credited to the gear and rev band it was recorded in,
        so the shares partition the same telemetry span the segment times do — the two numbers
        in the header are the check, not a claim. The last sample of a lap has no following
        sample to measure against and contributes nothing, which is why the difference is a
        tolerance rather than zero.{" "}
        {data.noTiming > 0
          ? `${data.noTiming} countable lap${data.noTiming === 1 ? "" : "s"} had no telemetry slice and ${
              data.noTiming === 1 ? "is" : "are"
            } in none of these shares. `
          : ""}
        Gears are counted as recorded — a gear the driver never selected simply has no row.
      </p>
    </section>
  );
}
