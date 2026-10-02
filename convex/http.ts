import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import type { LapRow, ResultRow, StintRow } from "./ingest";

const http = httpRouter();

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: status < 400, value }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function unauthorized() {
  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

function authorized(request: Request) {
  const secret = process.env.INGEST_SECRET;
  return Boolean(secret) && request.headers.get("x-ingest-secret") === secret;
}

http.route({
  path: "/ingest/upsertSeason",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return unauthorized();
    const body = (await request.json()) as { year: number };
    const id = await ctx.runMutation(internal.ingest.upsertSeason, {
      year: body.year,
    });
    return json(id);
  }),
});

http.route({
  path: "/ingest/upsertEvent",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return unauthorized();
    const body = (await request.json()) as {
      seasonId: string;
      round: number;
      name: string;
      officialName?: string;
      country: string;
      location?: string;
      startDate: number;
      endDate: number;
      format?: string;
      corners?: {
        number: number;
        letter?: string;
        x: number;
        y: number;
        angle: number;
        distance: number;
      }[];
    };
    const id = await ctx.runMutation(internal.ingest.upsertEvent, {
      seasonId: body.seasonId as Id<"seasons">,
      round: body.round,
      name: body.name,
      officialName: body.officialName,
      country: body.country,
      location: body.location,
      startDate: body.startDate,
      endDate: body.endDate,
      format: body.format,
      corners: body.corners,
    });
    return json(id);
  }),
});

http.route({
  path: "/ingest/upsertEventCorners",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return unauthorized();
    const body = (await request.json()) as {
      eventId: string;
      corners: {
        number: number;
        letter?: string;
        x: number;
        y: number;
        angle: number;
        distance: number;
      }[];
    };
    const id = await ctx.runMutation(internal.ingest.upsertEventCorners, {
      eventId: body.eventId as Id<"events">,
      corners: body.corners,
    });
    return json(id);
  }),
});

http.route({
  path: "/ingest/upsertSession",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return unauthorized();
    const body = (await request.json()) as {
      eventId: string;
      name: string;
      type?: string;
      startTime: number;
      endTime: number;
    };
    const id = await ctx.runMutation(internal.ingest.upsertSession, {
      eventId: body.eventId as Id<"events">,
      name: body.name,
      type: body.type,
      startTime: body.startTime,
      endTime: body.endTime,
    });
    return json(id);
  }),
});

http.route({
  path: "/ingest/setSessionStatus",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return unauthorized();
    const body = (await request.json()) as {
      sessionId: string;
      status: "pending" | "dispatched" | "ingesting" | "complete" | "failed" | "skipped";
      telemetry?: "full" | "partial" | "none" | "unknown";
      error?: string;
    };
    await ctx.runMutation(internal.ingest.setSessionStatus, {
      sessionId: body.sessionId as Id<"sessions">,
      status: body.status,
      telemetry: body.telemetry,
      error: body.error,
    });
    return json(null);
  }),
});

http.route({
  path: "/ingest/upsertResults",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return unauthorized();
    const body = (await request.json()) as {
      sessionId: string;
      rows: ResultRow[];
    };
    const count = await ctx.runMutation(internal.ingest.upsertResults, {
      sessionId: body.sessionId as Id<"sessions">,
      rows: body.rows,
    });
    return json(count);
  }),
});

http.route({
  path: "/ingest/upsertLaps",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return unauthorized();
    const body = (await request.json()) as {
      sessionId: string;
      driverNumber: string;
      laps: LapRow[];
    };
    const count = await ctx.runMutation(internal.ingest.upsertLaps, {
      sessionId: body.sessionId as Id<"sessions">,
      driverNumber: body.driverNumber,
      laps: body.laps,
    });
    return json(count);
  }),
});

http.route({
  path: "/ingest/upsertStints",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return unauthorized();
    const body = (await request.json()) as {
      sessionId: string;
      driverNumber: string;
      stints: StintRow[];
    };
    const count = await ctx.runMutation(internal.ingest.upsertStints, {
      sessionId: body.sessionId as Id<"sessions">,
      driverNumber: body.driverNumber,
      stints: body.stints,
    });
    return json(count);
  }),
});

http.route({
  path: "/ingest/uploadUrl",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return unauthorized();
    const url = await ctx.storage.generateUploadUrl();
    return json(url);
  }),
});

http.route({
  path: "/ingest/attachTelemetry",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return unauthorized();
    const body = (await request.json()) as {
      sessionId: string;
      driverNumber: string;
      provider: string;
      storageId?: string;
      storageKey?: string;
      format: string;
      channels: string[];
      sampleCount: number;
      bytes: number;
      freqHz?: number;
    };
    const id = await ctx.runMutation(internal.ingest.attachTelemetryFile, {
      sessionId: body.sessionId as Id<"sessions">,
      driverNumber: body.driverNumber,
      provider: body.provider,
      storageId: body.storageId ? (body.storageId as Id<"_storage">) : undefined,
      storageKey: body.storageKey,
      format: body.format,
      channels: body.channels,
      sampleCount: body.sampleCount,
      bytes: body.bytes,
      freqHz: body.freqHz,
    });
    return json(id);
  }),
});

http.route({
  path: "/ingest/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return unauthorized();
    const body = (await request.json()) as {
      deployment?: string;
      codeVersion?: string;
      codeStale?: boolean;
    };
    await ctx.runMutation(internal.worker.recordHeartbeat, {
      deployment: body.deployment ?? "unknown",
      codeVersion: body.codeVersion,
      codeStale: body.codeStale,
    });
    return json("ok");
  }),
});

export default http;
