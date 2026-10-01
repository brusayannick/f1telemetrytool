import { query } from "./_generated/server";
import { v } from "convex/values";

export const listTelemetryFiles = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const files = await ctx.db
      .query("telemetryFiles")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();

    const out = [];
    for (const file of files) {
      const url = await ctx.storage.getUrl(file.storageId);
      out.push({
        driverNumber: file.driverNumber,
        url,
        format: file.format,
        channels: file.channels,
        sampleCount: file.sampleCount,
        bytes: file.bytes,
        freqHz: file.freqHz ?? null,
      });
    }
    return out;
  },
});

/** Total telemetry storage in use — used by the ingest worker's backfill guard. */
export const storageUsage = query({
  args: {},
  handler: async (ctx) => {
    const files = await ctx.db.query("telemetryFiles").collect();
    let bytes = 0;
    for (const file of files) {
      bytes += file.bytes;
    }
    return { files: files.length, bytes };
  },
});
