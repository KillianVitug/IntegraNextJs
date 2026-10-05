import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import { attendanceSourcePeriods, attendanceSourceRuns, attendanceSourceMappings, attendanceSourceEvents, attendanceSourceProjections, attendanceSourceIdentities, attendanceResolutions } from "@/db/attendanceSourceSchema";
import { attendanceImportBatches, attendanceRawLogs, payrollRunEvents } from "@/db/schema";
import { sourceDayOffset } from "./attendanceSourceClient";
import { PayrollValidationError } from "./validation";

export async function lockAttendancePayrollInput(tx: DbClient) {
  await tx.execute(sql`select pg_advisory_xact_lock(73612849)`);
}

export function attendanceApiRequired(periodId: string) {
  const ids = (process.env.ATTENDANCE_API_REQUIRED_PERIOD_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean);
  if (ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new PayrollValidationError("Attendance-required period configuration is invalid. Ask the administrator to correct the configured period IDs before continuing payroll.");
  }
  return ids.some(id => id.toLowerCase() === periodId.toLowerCase());
}
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
  if (await attendanceSourceVersion(periodId, tx) !== version) throw new PayrollValidationError("Attendance changed while summaries were loading. Refresh again.");
  if (state && completedWholePeriod) await tx.update(attendanceSourcePeriods).set({ summariesRunId: state.inputRunId }).where(eq(attendanceSourcePeriods.payrollPeriodId, periodId));
}
export async function assertAttendanceSourceReady(periodId: string, database: DbClient = db) {
  const required = attendanceApiRequired(periodId);
  if (process.env.ATTENDANCE_SOURCE_ENABLED !== "true") {
    // Existing base tables remain available before connector migration. Compare
    // enum text so legacy databases without the API enum value remain compatible.
    const [apiBatch] = await database.select({ id: attendanceImportBatches.id }).from(attendanceImportBatches)
      .where(and(eq(attendanceImportBatches.payrollPeriodId, periodId), sql`${attendanceImportBatches.sourceFormat}::text = 'API'`)).limit(1);
    if (required || apiBatch) throw new PayrollValidationError("This period requires attendance API input, but the connection is disabled. Ask the administrator to restore the connection, then sync the period.");
    return null;
  }
  const [latest] = await database.select().from(attendanceSourceRuns).where(eq(attendanceSourceRuns.payrollPeriodId, periodId)).orderBy(desc(attendanceSourceRuns.startedAt)).limit(1);
  const [run] = await database.select().from(attendanceSourceRuns).where(and(eq(attendanceSourceRuns.payrollPeriodId, periodId), eq(attendanceSourceRuns.state, "Complete"))).orderBy(desc(attendanceSourceRuns.startedAt)).limit(1);
  const resolutionChanges = await database.select({ id: attendanceResolutions.id }).from(attendanceResolutions).where(and(or(eq(attendanceResolutions.payrollPeriodId, periodId), sql`${attendanceResolutions.duplicateMetadata}->'impactedPeriodIds' @> jsonb_build_array(${periodId}::text)`, sql`exists (select 1 from attendance_source_projections rp where rp.payroll_period_id = ${periodId}::uuid and ${attendanceResolutions.eventIds} @> jsonb_build_array(rp.event_id::text))`), or(sql`${attendanceResolutions.state} IN ('Pending','Sending','Failed')`, run ? sql`${attendanceResolutions.updatedAt} > ${run.startedAt}` : sql`true`))).limit(1);
  if (resolutionChanges.length) throw new PayrollValidationError("Attendance resolutions need approval or changed after this pull. Resolve pending cases, sync again and refresh DTR before continuing payroll.");
  if (!run) {
    if (latest || required) throw new PayrollValidationError("This period has no successful attendance API sync. Open Attendance connection and sync the whole period before computing payroll.");
    return null;
  }
  if (latest && latest.state !== "Complete" && latest.startedAt >= run.startedAt) throw new PayrollValidationError("The latest attendance sync has not completed successfully. Retry it in Attendance connection before continuing payroll.");
  const changedMappings = await database.select({ sourceId: attendanceSourceMappings.sourceEmployeeId })
    .from(attendanceSourceMappings)
    .innerJoin(attendanceSourceEvents, eq(attendanceSourceEvents.sourceEmployeeId, attendanceSourceMappings.sourceEmployeeId))
    .innerJoin(attendanceSourceProjections, eq(attendanceSourceProjections.eventId, attendanceSourceEvents.eventId))
    .where(and(eq(attendanceSourceProjections.payrollPeriodId, periodId), sql`${attendanceSourceMappings.updatedAt} > ${run.startedAt}`)).limit(1);
  if (changedMappings.length) throw new PayrollValidationError("Employee mappings changed after this attendance pull started. Sync the period again, refresh DTR summaries and recompute payroll.");
  // Durable identity revisions also cover removed mappings; absence of a mapping
  // must never let an old successful sync/summarization authorize payroll.
  const identityChanges = await database.select({ sourceId: attendanceSourceIdentities.sourceEmployeeId }).from(attendanceSourceIdentities)
    .innerJoin(attendanceSourceEvents, eq(attendanceSourceEvents.sourceEmployeeId, attendanceSourceIdentities.sourceEmployeeId))
    .innerJoin(attendanceSourceProjections, eq(attendanceSourceProjections.eventId, attendanceSourceEvents.eventId))
    .where(and(eq(attendanceSourceProjections.payrollPeriodId, periodId), sql`${attendanceSourceIdentities.updatedAt} > ${run.startedAt}`)).limit(1);
  if (identityChanges.length) throw new PayrollValidationError("Employee mappings or classifications changed after this attendance pull started. Sync again and refresh DTR before continuing payroll.");
  const changedEvidence = await database.select({ id: attendanceSourceEvents.eventId }).from(attendanceSourceProjections).innerJoin(attendanceSourceEvents, eq(attendanceSourceEvents.eventId, attendanceSourceProjections.eventId)).where(and(eq(attendanceSourceProjections.payrollPeriodId, periodId), sql`${attendanceSourceEvents.seenAt} > ${run.completedAt}`)).limit(1);
  if (changedEvidence.length) throw new PayrollValidationError("Source evidence changed since this period was synced. Sync again and review the updated attendance.");
  const [state] = await database.select().from(attendanceSourcePeriods).where(eq(attendanceSourcePeriods.payrollPeriodId, periodId));
  const counts = run?.counts as Record<string, number> | null;
  if (!counts || counts.unmatched || counts.withheld || counts.lateChanges || counts.boundaryReview || counts.clearedEmployees) throw new PayrollValidationError(`Attendance source has unresolved exceptions: ${counts?.unmatched ?? 0} unmatched, ${counts?.withheld ?? 0} withheld, ${counts?.boundaryReview ?? 0} boundary reviews, ${counts?.clearedEmployees ?? 0} cleared employee-periods and ${counts?.lateChanges ?? 0} late changes. Open Attendance connection, resolve the listed issues and sync again. Counts can overlap.`);
  if (state && state.inputRunId !== state.summariesRunId) throw new PayrollValidationError("Attendance API input changed. Refresh attendance summaries before computing payroll.");
  return run.id;
}
export async function confirmAttendanceSourcePayrollInput(tx: DbClient, periodId: string, version: string | null) {
  await lockAttendancePayrollInput(tx);
  if (await assertAttendanceSourceReady(periodId, tx) !== version) throw new PayrollValidationError("Attendance changed while payroll was computing. Refresh summaries and recompute.");
}

// Store the durable input version in the existing Computed audit event. An unchanged
// repeat pull need not force a recompute; changed input always has a new inputRunId.
export async function attendancePayrollSnapshot(tx: DbClient, periodId: string) {
  if (process.env.ATTENDANCE_SOURCE_ENABLED !== "true") return null;
  const [state] = await tx.select().from(attendanceSourcePeriods).where(eq(attendanceSourcePeriods.payrollPeriodId, periodId));
  return state?.inputRunId ?? null;
}

export async function assertAttendancePayrollSnapshot(tx: DbClient, periodId: string, payrollRunId: string) {
  await assertAttendanceSourceReady(periodId, tx);
  const inputRunId = await attendancePayrollSnapshot(tx, periodId);
  if (!inputRunId) return;
  const [event] = await tx.select({ notes: payrollRunEvents.notes }).from(payrollRunEvents)
    .where(and(eq(payrollRunEvents.payrollRunId, payrollRunId), eq(payrollRunEvents.eventType, "Computed")))
    .orderBy(desc(payrollRunEvents.createdAt), desc(payrollRunEvents.id)).limit(1);
  let snapshot: unknown;
  try { snapshot = JSON.parse(event?.notes ?? "null"); } catch { snapshot = null; }
  if (!snapshot || typeof snapshot !== "object" || !("attendanceSourceInputRunId" in snapshot) || snapshot.attendanceSourceInputRunId !== inputRunId) {
    throw new PayrollValidationError("This payroll was not computed from the current attendance input. Refresh DTR summaries and recompute the draft before reviewing, approving or posting it.");
  }
}
