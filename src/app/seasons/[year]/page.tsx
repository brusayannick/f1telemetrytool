"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { EventSessions } from "@/components/event-sessions";
import { Skeleton, SkeletonPills } from "@/components/skeleton";

export default function SeasonPage() {
  const params = useParams<{ year: string }>();
  const year = Number(params.year);
  const valid = Number.isFinite(year);

  const data = useQuery(
    api.sessions.listEvents,
    valid ? { year } : "skip",
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link
        href="/seasons"
        className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted transition-colors hover:text-accent-700"
      >
        ← Seasons
      </Link>

      <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">
        {valid ? year : "Unknown season"}
      </h1>

      {data === undefined ? (
        <div aria-busy className="mt-10 space-y-8">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="rounded-card border border-line bg-paper p-6">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-7 w-56" />
              <SkeletonPills className="mt-4" count={5} width="w-32" />
            </div>
          ))}
        </div>
      ) : data.events.length === 0 ? (
        <p className="mt-10 text-sm text-muted">
          No events stored for this season yet.
        </p>
      ) : (
        <ul className="mt-10 space-y-8">
          {data.events.map((event) => (
            <li
              key={event.id}
              className="rounded-card border border-line bg-paper p-6"
            >
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
                  Round {Math.round(event.round)}
                </span>
                <span className="text-sm text-muted">{event.country}</span>
              </div>
              <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight">
                {event.name}
              </h2>
              <EventSessions eventId={event.id} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
