"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Skeleton } from "@/components/skeleton";

export default function SeasonsPage() {
  const seasons = useQuery(api.sessions.listSeasons);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
        Browse
      </p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">
        Seasons
      </h1>

      {seasons === undefined ? (
        <div aria-busy className="mt-10 divide-y divide-line border-y border-line">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex items-center justify-between py-5">
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-3.5 w-16" />
            </div>
          ))}
        </div>
      ) : seasons.length === 0 ? (
        <div className="mt-10 rounded-card border border-line bg-paper p-6 text-sm text-muted">
          <p>No data stored yet. Ingest a weekend from this machine:</p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-tile-accent p-4 font-mono text-xs text-accent-800">
            python -m ingest.cli weekend --year 2025 --gp British
          </pre>
        </div>
      ) : (
        <ul className="mt-10 divide-y divide-line border-y border-line">
          {seasons.map((season) => (
            <li key={season.id}>
              <Link
                href={`/seasons/${season.year}`}
                className="flex items-center justify-between py-5 transition-colors hover:text-accent-700"
              >
                <span className="font-display text-2xl font-semibold tracking-tight">
                  {season.year}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
                  Open →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
