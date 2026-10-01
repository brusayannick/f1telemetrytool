"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SkeletonPills } from "@/components/skeleton";

const statusStyles: Record<string, string> = {
  complete: "bg-accent-100 text-accent-800",
  ingesting: "bg-accent-50 text-accent-700",
  requested: "bg-tile-lilac text-accent-800",
  dispatched: "bg-accent-50 text-accent-700",
  pending: "bg-tile-sand text-warning",
  failed: "bg-tile-lilac text-danger",
  skipped: "bg-tile-sand text-muted",
};

export function EventSessions({ eventId }: { eventId: Id<"events"> }) {
  const sessions = useQuery(api.sessions.listSessions, { eventId });

  if (sessions === undefined) {
    return <SkeletonPills className="mt-3" count={5} width="w-32" />;
  }

  if (sessions.length === 0) {
    return (
      <p className="py-3 text-sm text-muted">
        No sessions stored yet for this event.
      </p>
    );
  }

  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {sessions.map((session) => (
        <li key={session.id}>
          <Link
            href={`/sessions/${session.id}`}
            className="group flex items-center gap-3 rounded-full border border-line bg-paper px-4 py-2 text-sm transition-colors hover:border-accent-300"
          >
            <span className="font-medium">{session.name}</span>
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${
                statusStyles[session.ingestStatus] ?? "bg-tile-sand text-muted"
              }`}
            >
              {session.ingestStatus}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
              {session.telemetryAvailability}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
