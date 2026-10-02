import { type Infer, v } from "convex/values";
import { internalMutation } from "./_generated/server";

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      out[key] = entry;
    }
  }
  return out as T;
}

const statusValidator = v.union(
  v.literal("pending"),
  v.literal("dispatched"),
  v.literal("ingesting"),
  v.literal("complete"),
  v.literal("failed"),
  v.literal("skipped"),
);

const telemetryValidator = v.union(
  v.literal("full"),
  v.literal("partial"),
  v.literal("none"),
  v.literal("unknown"),
);

export const resultRowValidator = v.object({
  ergastDriverId: v.string(),
  ergastTeamId: v.string(),
  code: v.string(),
  firstName: v.string(),
  lastName: v.string(),
  teamName: v.string(),
  teamColor: v.optional(v.string()),
  driverNumber: v.string(),
  position: v.optional(v.number()),
  classifiedPosition: v.optional(v.string()),
  gridPosition: v.optional(v.number()),
  q1Ms: v.optional(v.number()),
  q2Ms: v.optional(v.number()),
  q3Ms: v.optional(v.number()),
  timeMs: v.optional(v.number()),
  status: v.optional(v.string()),
  points: v.optional(v.number()),
  laps: v.optional(v.number()),
});
export type ResultRow = Infer<typeof resultRowValidator>;

export const lapRowValidator = v.object({
  lapNumber: v.number(),
  lapTimeMs: v.optional(v.number()),
  lapStartMs: v.optional(v.number()),
  s1Ms: v.optional(v.number()),
  s2Ms: v.optional(v.number()),
  s3Ms: v.optional(v.number()),
  compound: v.optional(v.string()),
  tyreLife: v.optional(v.number()),
  freshTyre: v.optional(v.boolean()),
  stint: v.optional(v.number()),
  pitIn: v.optional(v.boolean()),
  pitOut: v.optional(v.boolean()),
  isAccurate: v.optional(v.boolean()),
  trackStatus: v.optional(v.string()),
  position: v.optional(v.number()),
  speedI1: v.optional(v.number()),
  speedI2: v.optional(v.number()),
  speedFL: v.optional(v.number()),
  speedST: v.optional(v.number()),
});
export type LapRow = Infer<typeof lapRowValidator>;

export const stintRowValidator = v.object({
  stintNumber: v.number(),
  compound: v.optional(v.string()),
  lapStart: v.optional(v.number()),
  lapEnd: v.optional(v.number()),
  tyreAgeAtStart: v.optional(v.number()),
});
export type StintRow = Infer<typeof stintRowValidator>;

export const upsertSeason = internalMutation({
  args: { year: v.number() },
  handler: async (ctx, { year }) => {
    const existing = await ctx.db
      .query("seasons")
      .withIndex("by_year", (q) => q.eq("year", year))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("seasons", { year });
  },
});

export const upsertEvent = internalMutation({
  args: {
    seasonId: v.id("seasons"),
    round: v.number(),
    name: v.string(),
    officialName: v.optional(v.string()),
    country: v.string(),
    location: v.optional(v.string()),
    startDate: v.number(),
    endDate: v.number(),
    format: v.optional(v.string()),
    corners: v.optional(
      v.array(
        v.object({
          number: v.number(),
          letter: v.optional(v.string()),
          x: v.number(),
          y: v.number(),
          angle: v.number(),
          distance: v.number(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("events")
      .withIndex("by_season_round", (q) =>
        q.eq("seasonId", args.seasonId).eq("round", args.round),
      )
      .first();
    const fields = {
      name: args.name,
      officialName: args.officialName,
      country: args.country,
      location: args.location,
      startDate: args.startDate,
      endDate: args.endDate,
      format: args.format,
      corners: args.corners,
    };
    if (existing) {
      await ctx.db.patch(existing._id, pruneUndefined(fields));
      return existing._id;
    }
    return await ctx.db.insert("events", {
      seasonId: args.seasonId,
      round: args.round,
      ...pruneUndefined(fields),
    });
  },
});

const cornerValidator = v.array(
  v.object({
    number: v.number(),
    letter: v.optional(v.string()),
    x: v.number(),
    y: v.number(),
    angle: v.number(),
    distance: v.number(),
  }),
);

/** Attach curated corner positions to an event without touching anything else. */
export const upsertEventCorners = internalMutation({
  args: { eventId: v.id("events"), corners: cornerValidator },
  handler: async (ctx, { eventId, corners }) => {
    await ctx.db.patch(eventId, { corners });
    return eventId;
  },
});

export const upsertSession = internalMutation({
  args: {
    eventId: v.id("events"),
    name: v.string(),
    type: v.optional(v.string()),
    startTime: v.number(),
    endTime: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_event_name", (q) =>
        q.eq("eventId", args.eventId).eq("name", args.name),
      )
      .first();
    if (existing) {
      // A completed session's window came from the real session data and is more
      // accurate than the schedule's provisional times, so a calendar re-sync must
      // not clobber it.
      const keepTimes = existing.ingestStatus === "complete";
      await ctx.db.patch(existing._id, {
        ...(args.type ? { type: args.type } : {}),
        ...(keepTimes ? {} : { startTime: args.startTime, endTime: args.endTime }),
      });
      return existing._id;
    }
    return await ctx.db.insert("sessions", {
      eventId: args.eventId,
      name: args.name,
      startTime: args.startTime,
      endTime: args.endTime,
      ingestStatus: "pending",
      telemetryAvailability: "unknown",
      ...(args.type ? { type: args.type } : {}),
    });
  },
});

export const setSessionStatus = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    status: statusValidator,
    telemetry: v.optional(telemetryValidator),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { sessionId, status, telemetry, error }) => {
    await ctx.db.patch(
      sessionId,
      pruneUndefined({
        ingestStatus: status,
        telemetryAvailability: telemetry,
        lastError: error,
      }),
    );
    return null;
  },
});

export const upsertResults = internalMutation({
  args: { sessionId: v.id("sessions"), rows: v.array(resultRowValidator) },
  handler: async (ctx, { sessionId, rows }) => {
    const existing = await ctx.db
      .query("driverSessionResults")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const row of existing) {
      await ctx.db.delete(row._id);
    }

    for (const row of rows) {
      const existingDriver = await ctx.db
        .query("drivers")
        .withIndex("by_ergast", (q) => q.eq("ergastId", row.ergastDriverId))
        .first();
      let driverId = existingDriver?._id;
      if (!driverId) {
        driverId = await ctx.db.insert("drivers", {
          ergastId: row.ergastDriverId,
          code: row.code,
          firstName: row.firstName,
          lastName: row.lastName,
        });
      }

      const existingTeam = await ctx.db
        .query("teams")
        .withIndex("by_ergast", (q) => q.eq("ergastId", row.ergastTeamId))
        .first();
      let teamId = existingTeam?._id;
      if (!teamId) {
        teamId = await ctx.db.insert(
          "teams",
          pruneUndefined({
            ergastId: row.ergastTeamId,
            name: row.teamName,
            color: row.teamColor,
          }),
        );
      }

      await ctx.db.insert(
        "driverSessionResults",
        pruneUndefined({
          sessionId,
          driverId,
          teamId,
          driverNumber: row.driverNumber,
          position: row.position,
          classifiedPosition: row.classifiedPosition,
          gridPosition: row.gridPosition,
          q1Ms: row.q1Ms,
          q2Ms: row.q2Ms,
          q3Ms: row.q3Ms,
          timeMs: row.timeMs,
          status: row.status,
          points: row.points,
          laps: row.laps,
        }),
      );
    }

    return rows.length;
  },
});

export const upsertLaps = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    driverNumber: v.string(),
    laps: v.array(lapRowValidator),
  },
  handler: async (ctx, { sessionId, driverNumber, laps }) => {
    const existing = await ctx.db
      .query("laps")
      .withIndex("by_session_driver", (q) =>
        q.eq("sessionId", sessionId).eq("driverNumber", driverNumber),
      )
      .collect();
    for (const lap of existing) {
      await ctx.db.delete(lap._id);
    }
    for (const lap of laps) {
      await ctx.db.insert("laps", pruneUndefined({ sessionId, driverNumber, ...lap }));
    }
    return laps.length;
  },
});

export const upsertStints = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    driverNumber: v.string(),
    stints: v.array(stintRowValidator),
  },
  handler: async (ctx, { sessionId, driverNumber, stints }) => {
    const existing = await ctx.db
      .query("stints")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const stint of existing) {
      if (stint.driverNumber === driverNumber) {
        await ctx.db.delete(stint._id);
      }
    }
    for (const stint of stints) {
      await ctx.db.insert(
        "stints",
        pruneUndefined({ sessionId, driverNumber, ...stint }),
      );
    }
    return stints.length;
  },
});

export const attachTelemetryFile = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    driverNumber: v.string(),
    provider: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    storageKey: v.optional(v.string()),
    format: v.string(),
    channels: v.array(v.string()),
    sampleCount: v.number(),
    bytes: v.number(),
    freqHz: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("telemetryFiles")
      .withIndex("by_session_driver", (q) =>
        q.eq("sessionId", args.sessionId).eq("driverNumber", args.driverNumber),
      )
      .first();

    // Default to Convex storage so a worker mid-run with the previous payload shape
    // (no provider field) keeps working across this deploy.
    const provider = args.provider ?? "convex";

    const doc = pruneUndefined({
      sessionId: args.sessionId,
      driverNumber: args.driverNumber,
      provider,
      storageId: args.storageId,
      storageKey: args.storageKey,
      format: args.format,
      channels: args.channels,
      sampleCount: args.sampleCount,
      bytes: args.bytes,
      freqHz: args.freqHz,
    });

    if (existing) {
      // Release the previous Convex-stored object; R2 objects are overwritten by key.
      if (existing.storageId) {
        await ctx.storage.delete(existing.storageId);
      }
      // replace() (not patch) so switching provider cannot leave a stale field behind
      await ctx.db.replace(existing._id, doc);
      return existing._id;
    }
    return await ctx.db.insert("telemetryFiles", doc);
  },
});
