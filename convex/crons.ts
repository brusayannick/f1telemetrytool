import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every 10 minutes: dispatch ingestion for sessions that just ended.
crons.interval(
  "dispatch due sessions",
  { minutes: 10 },
  internal.schedule.dispatchDueSessions,
);

export default crons;
