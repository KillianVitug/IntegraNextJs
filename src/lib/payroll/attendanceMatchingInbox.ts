import { sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import { attendanceSourceEvents as events } from "@/db/attendanceSourceSchema";
import type { AttendancePerson } from "./attendanceMatching";

/** One person per source identity, across all stored periods, including void-only identities. */
export async function attendanceMatchingInbox(database: Pick<DbClient, "select">): Promise<AttendancePerson[]> {
  return database.select({
    sourceId: events.sourceEmployeeId,
    names: sql<string[]>`array_agg(distinct ${events.payload}->>'employeeName' order by ${events.payload}->>'employeeName')`,
    branches: sql<string[]>`array_agg(distinct ${events.payload}->>'branchId' order by ${events.payload}->>'branchId')`,
    punchCount: sql<number>`count(*)::int`,
    validCount: sql<number>`(count(*) filter (where ${events.payload}->>'status' = 'VALID'))::int`,
    lastCapturedAt: sql<string>`to_char(max(${events.capturedAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  }).from(events).groupBy(events.sourceEmployeeId).orderBy(events.sourceEmployeeId);
}
