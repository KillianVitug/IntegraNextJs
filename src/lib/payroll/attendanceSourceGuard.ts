import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import { attendanceSourcePeriods, attendanceSourceRuns } from "@/db/attendanceSourceSchema";
import { attendanceImportBatches, attendanceRawLogs } from "@/db/schema";
import { sourceDayOffset } from "./attendanceSourceClient";
export function attendanceSourceDateFilter(start: string, end: string) {
  const original=and(gte(attendanceRawLogs.logDate,start),lte(attendanceRawLogs.logDate,end));
  if(process.env.ATTENDANCE_SOURCE_ENABLED !== "true") return original;
  return or(original,and(eq(attendanceImportBatches.sourceFormat,"API"),gte(attendanceRawLogs.logDate,sourceDayOffset(start,-1)),lte(attendanceRawLogs.logDate,sourceDayOffset(end,1))));
}
export async function attendanceSourceVersion(periodId: string, database: DbClient = db) {
  if (process.env.ATTENDANCE_SOURCE_ENABLED !== "true") return null;
  const [run] = await database.select().from(attendanceSourceRuns).where(and(eq(attendanceSourceRuns.payrollPeriodId, periodId), eq(attendanceSourceRuns.state, "Complete"))).orderBy(desc(attendanceSourceRuns.startedAt)).limit(1);
  return run?.id ?? null;
}
export async function confirmAttendanceSourceSummaryRefresh(tx: DbClient, periodId: string, version: string | null, completedWholePeriod = true) {
  if (process.env.ATTENDANCE_SOURCE_ENABLED !== "true") return;
  await tx.execute(sql`select pg_advisory_xact_lock(73612849)`);
  const [state] = await tx.select().from(attendanceSourcePeriods).where(eq(attendanceSourcePeriods.payrollPeriodId, periodId));
  if (await attendanceSourceVersion(periodId, tx) !== version) throw Error("Attendance changed while summaries were loading. Refresh again.");
  if (state && completedWholePeriod) await tx.update(attendanceSourcePeriods).set({ summariesRunId: state.inputRunId }).where(eq(attendanceSourcePeriods.payrollPeriodId, periodId));
}
export async function assertAttendanceSourceReady(periodId: string, database: DbClient = db) {
  if (process.env.ATTENDANCE_SOURCE_ENABLED !== "true") return null;
  const [run] = await database.select().from(attendanceSourceRuns).where(and(eq(attendanceSourceRuns.payrollPeriodId, periodId), eq(attendanceSourceRuns.state, "Complete"))).orderBy(desc(attendanceSourceRuns.startedAt)).limit(1);
  if (!run) return null;
  const [state] = await database.select().from(attendanceSourcePeriods).where(eq(attendanceSourcePeriods.payrollPeriodId, periodId));
  const counts = run?.counts as Record<string, number> | null;
  if (!run || !counts || counts.unmatched || counts.withheld || counts.lateChanges || counts.boundaryReview || counts.clearedEmployees) throw Error("Attendance source has unresolved exceptions. Review employee mappings, boundary punches and withheld/cleared employees before payroll.");
  if (state && state.inputRunId !== state.summariesRunId) throw Error("Attendance API input changed. Refresh attendance summaries before computing payroll.");
  return run.id;
}
export async function confirmAttendanceSourcePayrollInput(tx: DbClient, periodId: string, version: string | null) {
  if (process.env.ATTENDANCE_SOURCE_ENABLED !== "true") return;
  await tx.execute(sql`select pg_advisory_xact_lock(73612849)`);
  if (await assertAttendanceSourceReady(periodId, tx) !== version) throw Error("Attendance changed while payroll was computing. Refresh summaries and recompute.");
}
