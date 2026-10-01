import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

const HEARTBEAT_KEY = "worker-heartbeat";

/**
 * Written by the local ingest worker on every poll (see POST /ingest/heartbeat).
 *
 * Because heartbeats live *in the deployment*, a deployment that has no worker shows
 * no heartbeat — which is exactly the signal the browser needs to distinguish
 * "the worker is fetching this" from "no worker is running at all".
 */
export const recordHeartbeat = internalMutation({
  args: { deployment: v.string() },
  handler: async (ctx, { deployment }) => {
    const existing = await ctx.db
      .query("syncState")
      .withIndex("by_key", (q) => q.eq("key", HEARTBEAT_KEY))
      .first();

    const value = { atMs: Date.now(), deployment };
    if (existing) {
      await ctx.db.patch(existing._id, { value });
      return existing._id;
    }
    return await ctx.db.insert("syncState", { key: HEARTBEAT_KEY, value });
  },
});

/**
 * Liveness of the worker watching this deployment, or null if none ever checked in.
 * Freshness is judged by the caller so it does not depend on the deployment clock.
 */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("syncState")
      .withIndex("by_key", (q) => q.eq("key", HEARTBEAT_KEY))
      .first();
    if (!row) return null;

    const value = row.value as { atMs?: number; deployment?: string } | null;
    if (!value?.atMs) return null;
    return {
      lastSeenMs: value.atMs,
      deployment: value.deployment ?? "unknown",
    };
  },
});
