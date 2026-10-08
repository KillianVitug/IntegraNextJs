import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import { attendanceDtrCorrections, attendanceImportBatches, attendanceRawLogs } from "@/db/schema";
import type { AttendanceApprovedCorrectionRecord } from "./attendanceSync";
import { sourceDayOffset } from "./attendanceSourceClient";

type AttendanceScope = { employeeIds?: string[]; payrollPeriodId?: string; startDate: string; endDate: string };

/** One effective-input boundary for DTR refresh, reads and schedule-triggered rebuilds.
 * Recorded decisions remain authoritative even if a feature flag is later disabled.
 * The second predicate also protects duplicate source projections in a neighboring period.
 */
export function effectiveAttendanceRawPredicate() {
  return and(
    sql`not exists (select 1 from attendance_work_exclusions x where x.raw_log_id = ${attendanceRawLogs.id} and x.active)`,
    sql`(not exists (select 1 from attendance_work_treatments d where d.employee_id = ${attendanceRawLogs.employeeId} and d.day = ${attendanceRawLogs.logDate} and d.active and d.payload->>'kind' = 'AdminDecision')
      or exists (select 1 from attendance_work_raw_logs r join attendance_work_treatments d on d.plan_id = r.plan_id where r.raw_log_id = ${attendanceRawLogs.id} and d.employee_id = ${attendanceRawLogs.employeeId} and d.day = ${attendanceRawLogs.logDate} and d.active and d.payload->>'kind' = 'AdminDecision'))`,
  );
}

export async function loadEffectiveAttendanceRawLogs(database: DbClient, scope: AttendanceScope & { neighborDays?: "api" | "all" | "none" }) {
  if (scope.employeeIds?.length === 0) return [];
  const original = and(gte(attendanceRawLogs.logDate, scope.startDate), lte(attendanceRawLogs.logDate, scope.endDate));
  const neighbors = and(gte(attendanceRawLogs.logDate, sourceDayOffset(scope.startDate, -1)), lte(attendanceRawLogs.logDate, sourceDayOffset(scope.endDate, 1)));
  const dateFilter = scope.neighborDays === "all" ? neighbors : scope.neighborDays === "api" ? or(original, and(eq(attendanceImportBatches.sourceFormat, "API"), neighbors)) : original;
  const rows = await database.select({
    id: attendanceRawLogs.id, employeeId: attendanceRawLogs.employeeId, employeeNo: attendanceRawLogs.employeeNo,
    batchId: attendanceRawLogs.batchId, sourceFileName: attendanceImportBatches.sourceFileName,
    loggedAt: attendanceRawLogs.loggedAt, logDate: attendanceRawLogs.logDate, logTime: attendanceRawLogs.logTime,
    direction: attendanceRawLogs.direction, sourceLine: attendanceRawLogs.sourceLine, rawText: attendanceRawLogs.rawText,
    deviceId: attendanceRawLogs.deviceId, siteCode: attendanceRawLogs.siteCode, normalizedHash: attendanceRawLogs.normalizedHash,
  }).from(attendanceRawLogs).innerJoin(attendanceImportBatches, eq(attendanceRawLogs.batchId, attendanceImportBatches.id)).where(and(
    isNotNull(attendanceRawLogs.employeeId), scope.employeeIds ? inArray(attendanceRawLogs.employeeId, scope.employeeIds) : undefined,
    scope.payrollPeriodId ? eq(attendanceImportBatches.payrollPeriodId, scope.payrollPeriodId) : undefined,
    dateFilter, effectiveAttendanceRawPredicate(),
  )).orderBy(asc(attendanceRawLogs.employeeId), asc(attendanceRawLogs.loggedAt), asc(attendanceRawLogs.id));
  // A phone event may be projected into both periods for overnight context. Count
  // the same identified, unchanged capture once; distinct same-time captures stay.
  const seen = new Set<string>();
  return rows.filter(row => {
    let identity = row.normalizedHash;
    if (row.sourceFileName.startsWith("admin-decision:")) {
      try { const data = JSON.parse(row.rawText ?? "{}"); if (typeof data.recordId === "string") identity = `decision:${data.recordId}`; } catch { /* Keep the stored row identity if legacy text is not JSON. */ }
    }
    if (!identity) return true;
    const key = [row.employeeId, identity, row.logDate, row.logTime, row.direction].join("|");
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export async function loadEffectiveAttendanceCorrections(database: DbClient, scope: AttendanceScope) {
  if (scope.employeeIds?.length === 0) return [];
  return database.select().from(attendanceDtrCorrections).where(and(
    scope.payrollPeriodId ? eq(attendanceDtrCorrections.payrollPeriodId, scope.payrollPeriodId) : undefined,
    scope.employeeIds ? inArray(attendanceDtrCorrections.employeeId, scope.employeeIds) : undefined,
    eq(attendanceDtrCorrections.status, "Approved"), gte(attendanceDtrCorrections.attendanceDate, scope.startDate), lte(attendanceDtrCorrections.attendanceDate, scope.endDate),
    sql`not exists (select 1 from attendance_work_treatments d where d.employee_id = ${attendanceDtrCorrections.employeeId} and d.day = ${attendanceDtrCorrections.attendanceDate} and d.active and d.payload->>'kind' = 'AdminDecision')`,
  ));
}

export function mapEffectiveAttendanceCorrections(rows: Array<typeof attendanceDtrCorrections.$inferSelect>): AttendanceApprovedCorrectionRecord[] {
  return rows.map(({ employeeId, attendanceDate, correctionType, payload }) => ({ employeeId, attendanceDate, correctionType, payload }));
}
