import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const ingestStatus = v.union(
  v.literal("pending"),
  v.literal("dispatched"),
  v.literal("ingesting"),
  v.literal("complete"),
  v.literal("failed"),
  v.literal("skipped"),
);

const telemetryAvailability = v.union(
  v.literal("full"),
  v.literal("partial"),
  v.literal("none"),
  v.literal("unknown"),
);

export default defineSchema({
  seasons: defineTable({
    year: v.number(),
  }).index("by_year", ["year"]),

  events: defineTable({
    seasonId: v.id("seasons"),
    round: v.number(),
    name: v.string(),
    officialName: v.optional(v.string()),
    country: v.string(),
    location: v.optional(v.string()),
    startDate: v.number(),
    endDate: v.number(),
    format: v.optional(v.string()),
  })
    .index("by_season_round", ["seasonId", "round"])
    .index("by_start", ["startDate"]),

  sessions: defineTable({
    eventId: v.id("events"),
    name: v.string(),
    type: v.optional(v.string()),
    startTime: v.number(),
    endTime: v.number(),
    ingestStatus,
    telemetryAvailability,
    lastError: v.optional(v.string()),
  })
    .index("by_event", ["eventId"])
    .index("by_event_name", ["eventId", "name"])
    .index("by_status_end", ["ingestStatus", "endTime"]),

  drivers: defineTable({
    ergastId: v.string(),
    code: v.string(),
    firstName: v.string(),
    lastName: v.string(),
  }).index("by_ergast", ["ergastId"]),

  teams: defineTable({
    ergastId: v.string(),
    name: v.string(),
    color: v.optional(v.string()),
  }).index("by_ergast", ["ergastId"]),

  driverSessionResults: defineTable({
    sessionId: v.id("sessions"),
    driverId: v.id("drivers"),
    teamId: v.id("teams"),
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
  })
    .index("by_session", ["sessionId"])
    .index("by_session_driver", ["sessionId", "driverNumber"]),

  laps: defineTable({
    sessionId: v.id("sessions"),
    driverNumber: v.string(),
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
  })
    .index("by_session", ["sessionId"])
    .index("by_session_driver", ["sessionId", "driverNumber"]),

  stints: defineTable({
    sessionId: v.id("sessions"),
    driverNumber: v.string(),
    stintNumber: v.number(),
    compound: v.optional(v.string()),
    lapStart: v.optional(v.number()),
    lapEnd: v.optional(v.number()),
    tyreAgeAtStart: v.optional(v.number()),
  }).index("by_session", ["sessionId"]),

  telemetryFiles: defineTable({
    sessionId: v.id("sessions"),
    driverNumber: v.string(),
    storageId: v.id("_storage"),
    format: v.string(),
    channels: v.array(v.string()),
    sampleCount: v.number(),
    bytes: v.number(),
    freqHz: v.optional(v.number()),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_driver", ["sessionId", "driverNumber"]),

  anomalies: defineTable({
    sessionId: v.id("sessions"),
    driverNumber: v.string(),
    lapNumber: v.number(),
    score: v.number(),
    modelVersion: v.string(),
    topFeatures: v.optional(v.any()),
    category: v.optional(v.string()),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_driver", ["sessionId", "driverNumber"]),

  historyDocs: defineTable({
    year: v.number(),
    round: v.number(),
    kind: v.string(),
    payload: v.any(),
  }).index("by_year_round", ["year", "round"]),

  syncState: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),
});
