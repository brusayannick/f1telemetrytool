import { ArrowLeftRight, Map, Sparkles } from "lucide-react";
import { DemoTelemetryChart } from "@/components/demo-telemetry-chart";

const nav = [
  { label: "Seasons", href: "#" },
  { label: "Sessions", href: "#" },
  { label: "Compare", href: "#" },
  { label: "Drivers", href: "#" },
];

const stats = [
  { value: "1,700+", label: "sessions from 2018 → today" },
  { value: "4 Hz", label: "car telemetry sampling" },
  { value: "0.1 m", label: "position resolution" },
  { value: "100%", label: "quick laps scored for anomalies" },
];

const features = [
  {
    icon: ArrowLeftRight,
    eyebrow: "Compare",
    title: "Lap vs. lap, distance-aligned",
    body: "Overlay speed, throttle, brake, gear, RPM and DRS for any two laps. Delta time is computed by time interpolation on a shared distance grid — not eyeballed charts.",
  },
  {
    icon: Map,
    eyebrow: "Track",
    title: "Position with context",
    body: "Every sample mapped onto the circuit with corner annotations and channel-colored trails, from the 2018 season to today.",
  },
  {
    icon: Sparkles,
    eyebrow: "Detect",
    title: "Anomalies surfaced automatically",
    body: "Unsupervised models score every quick lap against the driver's own baseline and the field — flagging lockups, off-tracks and pace drops with explanations.",
  },
];

export default function Home() {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <span className="font-display text-lg font-semibold tracking-tight">
            F1<span className="text-accent-600">Telemetry</span>
          </span>
          <nav className="hidden items-center gap-8 md:flex">
            {nav.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="text-sm text-muted transition-colors hover:text-ink"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <a
            href="#"
            className="rounded-full bg-accent-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700"
          >
            Open workbench
          </a>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-16 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent-700">
              Unofficial · built on FastF1
            </p>
            <h1 className="mt-4 font-display text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
              Every lap. Every driver. Every session.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted">
              Detailed car telemetry from the 2018 season onwards — compared lap
              by lap, corner by corner, and scored for anomalies automatically.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#"
                className="rounded-full bg-accent-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-700"
              >
                Explore seasons
              </a>
              <a
                href="#"
                className="rounded-full border border-line bg-paper px-6 py-3 text-sm font-medium transition-colors hover:border-accent-300 hover:text-accent-700"
              >
                How it works
              </a>
            </div>
          </div>
          <div className="rounded-card bg-tile-accent p-6">
            <div className="rounded-2xl border border-line bg-paper p-4 shadow-[0_1px_2px_rgba(11,11,11,0.06)]">
              <DemoTelemetryChart />
              <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-muted">
                Synthetic demo · speed + throttle · distance axis
              </p>
            </div>
          </div>
        </section>

        <section className="border-y border-line bg-paper">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-10 md:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label}>
                <p className="font-mono text-2xl font-medium tabular-nums">
                  {stat.value}
                </p>
                <p className="mt-1 text-sm text-muted">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
            Platform
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight md:text-4xl">
            A telemetry workbench, not a dashboard
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {features.map((feature) => (
              <article
                key={feature.title}
                className="rounded-card border border-line bg-paper p-6 transition-shadow hover:shadow-[0_8px_30px_rgba(11,11,11,0.06)]"
              >
                <feature.icon
                  className="h-5 w-5 text-accent-600"
                  strokeWidth={1.75}
                />
                <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
                  {feature.eyebrow}
                </p>
                <h3 className="mt-2 font-display text-xl font-semibold tracking-tight">
                  {feature.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  {feature.body}
                </p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-paper">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 text-sm text-muted md:flex-row md:items-center md:justify-between">
          <p>
            Data by FastF1 · Jolpica · OpenF1 — unofficial, not associated with
            Formula 1.
          </p>
          <p className="font-mono text-xs uppercase tracking-widest">
            Vercel + Convex
          </p>
        </div>
      </footer>
    </>
  );
}
