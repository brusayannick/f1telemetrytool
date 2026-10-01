import { query } from "./_generated/server";
import { v } from "convex/values";

export const listTelemetryFiles = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const files = await ctx.db
      .query("telemetryFiles")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();

    // Public read base URL for the R2 bucket ("https://pub-….r2.dev" or a custom
    // domain). Not a secret, so it is read straight from the deployment env.
    const base = (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");

    const out = [];
    for (const file of files) {
      let url: string | null = null;
      if (file.storageKey && base) {
        url = `${base}/${file.storageKey}`;
      } else if (file.storageId) {
        url = await ctx.storage.getUrl(file.storageId);
      }
      out.push({
        driverNumber: file.driverNumber,
        url,
        provider: file.provider ?? "convex",
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
