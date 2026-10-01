import { api, internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";

/**
 * Sessions that ended long enough ago that the F1 feed should be final,
 * but recently enough that they are still worth ingesting.
 */
export const dueSessions = query({
  args: {
    nowMs: v.optional(v.number()),
    bufferMinutes: v.optional(v.number()),
    lookbackHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.nowMs ?? Date.now();
    const bufferMs = (args.bufferMinutes ?? 45) * 60_000;
    const lookbackMs = (args.lookbackHours ?? 8) * 3_600_000;
    const cutoff = now - bufferMs;
    const floor = now - lookbackMs;

    const candidates = await ctx.db
      .query("sessions")
      .withIndex("by_status_end", (q) =>
        q.eq("ingestStatus", "pending").lt("endTime", cutoff),
      )
      .collect();
    const due = candidates.filter((session) => session.endTime > floor);

    const out = [];
    for (const session of due) {
      const event = await ctx.db.get(session.eventId);
      if (!event) continue;
      const season = await ctx.db.get(event.seasonId);
      out.push({
        sessionId: session._id,
        year: season?.year ?? null,
        round: event.round,
        eventName: event.name,
        sessionName: session.name,
        endTime: session.endTime,
      });
    }
    return out;
  },
});

export const markDispatched = internalMutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    await ctx.db.patch(sessionId, { ingestStatus: "dispatched" });
  },
});

/**
 * Just-in-time ingestion trigger: finds sessions that just ended and
 * dispatches the GitHub Actions ingest workflow for each of them.
 * Configure GH_DISPATCH_TOKEN (fine-grained PAT, Actions: write) and
 * GH_REPO ("owner/repo") in the Convex deployment environment.
 */
export const dispatchDueSessions = internalAction({
  args: {},
  handler: async (ctx) => {
    const token = process.env.GH_DISPATCH_TOKEN;
    const repo = process.env.GH_REPO;
    if (!token || !repo) {
      return {
        dispatched: 0,
        skipped: "GH_DISPATCH_TOKEN and/or GH_REPO not configured",
      };
    }

    const due = await ctx.runQuery(api.schedule.dueSessions, {});
    let dispatched = 0;
    for (const session of due) {
      const response = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/ingest-session.yml/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ref: "main",
            inputs: { sessionKey: String(session.sessionId) },
          }),
        },
      );
      if (response.ok) {
        await ctx.runMutation(internal.schedule.markDispatched, {
          sessionId: session.sessionId,
        });
        dispatched += 1;
      }
    }
    return { dispatched };
  },
});
