"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;

const client = url ? new ConvexReactClient(url) : null;

export function Providers({ children }: { children: ReactNode }) {
  if (!client) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 font-mono text-sm text-danger">
        NEXT_PUBLIC_CONVEX_URL is not set. Run <code>npx convex dev</code> to create
        <code> .env.local</code>.
      </div>
    );
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
