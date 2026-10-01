import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listSeasons = query({
  args: {},
  handler: async (ctx) => {
    const seasons = await ctx.db
      .query("seasons")
      .withIndex("by_year")
      .order("desc")
      .collect();
    return seasons.map((season) => ({ id: season._id, year: season.year }));
  },
});

export const listEvents = query({
  args: { year: v.number() },
  handler: async (ctx, { year }) => {
    const season = await ctx.db
      .query("seasons")
      .withIndex("by_year", (q) => q.eq("year", year))
      .first();
    if (!season) {
      return { seasonId: null, events: [] };
    }
    const events = await ctx.db
      .query("events")
      .withIndex("by_season_round", (q) => q.eq("seasonId", season._id))
      .collect();
    events.sort((a, b) => a.round - b.round);
    return {
      seasonId: season._id,
      events: events.map((event) => ({
        id: event._id,
        round: event.round,
        name: event.name,
        officialName: event.officialName ?? null,
        country: event.country,
        location: event.location ?? null,
        startDate: event.startDate,
        endDate: event.endDate,
      })),
    };
  },
});

export const listSessions = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    sessions.sort((a, b) => a.startTime - b.startTime);
    return sessions.map((session) => ({
      id: session._id,
      name: session.name,
      type: session.type ?? null,
      startTime: session.startTime,
      endTime: session.endTime,
      ingestStatus: session.ingestStatus,
      telemetryAvailability: session.telemetryAvailability,
    }));
  },
});

export const getSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return null;
    const event = await ctx.db.get(session.eventId);
    const season = event ? await ctx.db.get(event.seasonId) : null;
    return {
      session: {
        id: session._id,
        name: session.name,
        type: session.type ?? null,
        startTime: session.startTime,
        endTime: session.endTime,
        ingestStatus: session.ingestStatus,
        telemetryAvailability: session.telemetryAvailability,
      },
      event: event
        ? {
            id: event._id,
            round: event.round,
            name: event.name,
            officialName: event.officialName ?? null,
            country: event.country,
          }
        : null,
      year: season?.year ?? null,
    };
  },
});

export const statusFor = query({
  args: { year: v.number(), round: v.number(), name: v.string() },
  handler: async (ctx, { year, round, name }) => {
    const season = await ctx.db
      .query("seasons")
      .withIndex("by_year", (q) => q.eq("year", year))
      .first();
    if (!season) return null;
    const event = await ctx.db
      .query("events")
      .withIndex("by_season_round", (q) =>
        q.eq("seasonId", season._id).eq("round", round),
      )
      .first();
    if (!event) return null;
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_event_name", (q) =>
        q.eq("eventId", event._id).eq("name", name),
      )
      .first();
    if (!session) return null;
    return {
      sessionId: session._id,
      ingestStatus: session.ingestStatus,
      telemetryAvailability: session.telemetryAvailability,
    };
  },
});

export const listResults = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const rows = await ctx.db
      .query("driverSessionResults")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();

    const out = [];
    for (const row of rows) {
      const driver = await ctx.db.get(row.driverId);
      const team = await ctx.db.get(row.teamId);
      out.push({
        driverNumber: row.driverNumber,
        code: driver?.code ?? "",
        fullName: driver ? `${driver.firstName} ${driver.lastName}` : "",
        teamName: team?.name ?? "",
        teamColor: team?.color ?? null,
        position: row.position ?? null,
        classifiedPosition: row.classifiedPosition ?? null,
        gridPosition: row.gridPosition ?? null,
        q1Ms: row.q1Ms ?? null,
        q2Ms: row.q2Ms ?? null,
        q3Ms: row.q3Ms ?? null,
        timeMs: row.timeMs ?? null,
        status: row.status ?? null,
        points: row.points ?? null,
        laps: row.laps ?? null,
      });
    }

    out.sort((a, b) => {
      const pa = a.position ?? Number.MAX_SAFE_INTEGER;
      const pb = b.position ?? Number.MAX_SAFE_INTEGER;
      return pa - pb;
    });

    return out;
  },
});

/**
 * Mark a session for on-demand ingestion. The local worker polls
 * `requestedSessions` and fetches the telemetry from a residential IP, which is the
 * only place the F1 feed is reachable.
 */
export const requestIngest = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) {
      throw new Error("session not found");
    }
    if (
      session.ingestStatus === "complete" ||
      session.ingestStatus === "ingesting" ||
      session.ingestStatus === "requested"
    ) {
      return session.ingestStatus;
    }
    await ctx.db.patch(sessionId, {
      ingestStatus: "requested",
      lastError: undefined,
    });
    return "requested";
  },
});

/** Sessions waiting for the local worker, with the keys FastF1 needs. */
export const requestedSessions = query({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_status_end", (q) => q.eq("ingestStatus", "requested"))
      .collect();

    const out = [];
    for (const session of sessions) {
      const event = await ctx.db.get(session.eventId);
      if (!event) continue;
      const season = await ctx.db.get(event.seasonId);
      out.push({
        sessionId: session._id,
        year: season?.year ?? null,
        round: event.round,
        eventName: event.name,
        sessionName: session.name,
      });
    }
    return out;
  },
});

export const listLaps = query({
  args: { sessionId: v.id("sessions"), driverNumber: v.optional(v.string()) },
  handler: async (ctx, { sessionId, driverNumber }) => {
    const laps = driverNumber
      ? await ctx.db
          .query("laps")
          .withIndex("by_session_driver", (q) =>
            q.eq("sessionId", sessionId).eq("driverNumber", driverNumber),
          )
          .collect()
      : await ctx.db
          .query("laps")
          .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
          .collect();

    laps.sort((a, b) => a.lapNumber - b.lapNumber);

    return laps.map((lap) => ({
      id: lap._id,
      driverNumber: lap.driverNumber,
      lapNumber: lap.lapNumber,
      lapTimeMs: lap.lapTimeMs ?? null,
      lapStartMs: lap.lapStartMs ?? null,
      s1Ms: lap.s1Ms ?? null,
      s2Ms: lap.s2Ms ?? null,
      s3Ms: lap.s3Ms ?? null,
      compound: lap.compound ?? null,
      tyreLife: lap.tyreLife ?? null,
      freshTyre: lap.freshTyre ?? null,
      stint: lap.stint ?? null,
      pitIn: lap.pitIn ?? null,
      pitOut: lap.pitOut ?? null,
      isAccurate: lap.isAccurate ?? null,
      trackStatus: lap.trackStatus ?? null,
      position: lap.position ?? null,
      speedI1: lap.speedI1 ?? null,
      speedI2: lap.speedI2 ?? null,
      speedFL: lap.speedFL ?? null,
      speedST: lap.speedST ?? null,
    }));
  },
});
