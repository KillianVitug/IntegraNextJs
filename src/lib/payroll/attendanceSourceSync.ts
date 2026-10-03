import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import { employees, payrollPeriods, payrollRuns, attendanceImportBatches, attendanceRawLogs, attendanceDailySummaries } from "@/db/schema";
import { attendanceSourceEvents as events, attendanceSourceMappings as mappings, attendanceSourceRuns as runs, attendanceSourceRevisions as revisions, attendanceSourceProjections as projections, attendanceSourcePeriods as sourcePeriods } from "@/db/attendanceSourceSchema";
import { adminAuditEvents, payrollRunEvents } from "@/db/schema";
import { manilaWallTime, pullAttendanceSource, sourceDayOffset, type SourcePunch } from "./attendanceSourceClient";
import { lockAttendancePayrollInput } from "./attendanceSourceGuard";
import { PayrollValidationError } from "./validation";
import { assertAttendanceSourcePeriodAllowed } from "./attendanceSourceRollout";

export const attendanceSourceEnabled = () => process.env.ATTENDANCE_SOURCE_ENABLED === "true";
export function requireAttendanceSource() { if (!attendanceSourceEnabled()) throw Error("Attendance API integration is disabled"); }
const canonical = (value: unknown): string => Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]" : value && typeof value === "object" ? "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k])).join(",") + "}" : JSON.stringify(value);
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
// Storage-only audit helpers keep the reconciler independent of browser/session imports.
async function recordAdminAuditEvent(args: Parameters<typeof import("@/lib/admin").recordAdminAuditEvent>[0]) {
  await (args.database ?? db).insert(adminAuditEvents).values({ actorUserId: args.actorUserId, entityType: args.entityType, entityId: args.entityId == null ? null : String(args.entityId), action: args.action, details: JSON.stringify(args.details) });
}
async function recordPayrollRunEvent(args: Parameters<typeof import("@/lib/admin").recordPayrollRunEvent>[0]) {
  await (args.database ?? db).insert(payrollRunEvents).values({ payrollRunId: args.payrollRunId, actorUserId: args.actorUserId, eventType: args.eventType, fromStatus: args.fromStatus, toStatus: args.toStatus, notes: args.notes });
}
export async function syncAttendanceSourcePeriod(periodId: string, actorUserId: string) {
  requireAttendanceSource();
  const period = await db.query.payrollPeriods.findFirst({ where: eq(payrollPeriods.id, periodId) });
  if (!period) throw Error("Payroll period not found");
  assertAttendanceSourcePeriodAllowed(period.startDate);
  const runId = randomUUID();
  // A partial pull never changes source events, summaries or payroll input.
  const from = sourceDayOffset(period.startDate, -1), through = sourceDayOffset(period.endDate, 1);
  await db.transaction(async tx => {
    await lockAttendancePayrollInput(tx);
    await tx.insert(runs).values({ id: runId, payrollPeriodId: periodId, actorUserId, state: "Fetching", fromDate: from, throughDate: through });
  });
  try {
    const records = await pullAttendanceSource({ origin: process.env.ATTENDANCE_SOURCE_ORIGIN ?? "", token: process.env.ATTENDANCE_SOURCE_TOKEN ?? "", from, through });
    const counts = await reconcileAttendanceSource(db, periodId, runId, actorUserId, records);
    return { runId, ...counts };
  } catch {
    // Do not persist HTTP bodies, URLs containing credentials, or third-party error details.
    await db.update(runs).set({ state: "Failed", error: "Source pull or reconciliation failed; prior payroll input retained", completedAt: new Date() }).where(eq(runs.id, runId));
    throw new PayrollValidationError("Attendance sync failed. Prior payroll input was retained. Check server configuration and sync history, then retry the whole period.");
  }
}
export async function reconcileAttendanceSource(database: typeof db, periodId: string, runId: string, actorUserId: string, records: SourcePunch[]) {
  return database.transaction(async tx => {
    // All source jobs serialize. A slower, earlier pull cannot overwrite a newer completed one.
    await tx.execute(sql`select pg_advisory_xact_lock(73612849)`);
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId));
    if (!run || run.state !== "Fetching") throw Error("Sync run is no longer active");
    const newer = await tx.select().from(runs).where(and(eq(runs.payrollPeriodId, periodId), eq(runs.state, "Complete"), gte(runs.startedAt, run.startedAt)));
    if (newer.some(r => r.id !== runId)) throw Error("A newer period pull already completed");
    const [period] = await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId)).for("update");
    if (!period || sourceDayOffset(period.startDate,-1) !== run.fromDate || sourceDayOffset(period.endDate,1) !== run.throughDate) throw Error("Payroll period changed during sync");
    const periodRuns = await tx.select().from(payrollRuns).where(eq(payrollRuns.payrollPeriodId, periodId)).for("update");
    const protectedPeriod = period.status !== "Open" || periodRuns.some(r => r.status === "Posted");
    const roster = await tx.select({ sourceId: mappings.sourceEmployeeId, employeeId: employees.id, employeeNo: employees.employeeNo, deletedAt: employees.deletedAt }).from(mappings).innerJoin(employees, eq(employees.id, mappings.employeeId));
    const mapping = new Map(roster.filter(r => !r.deletedAt && r.employeeNo).map(r => [r.sourceId, r]));
    const oldProjections = await tx.select().from(projections).where(eq(projections.payrollPeriodId, periodId));
    const oldById = new Map(oldProjections.map(r => [r.eventId, r]));
    const incomingIds = new Set(records.map(r => r.eventId));
    if (oldProjections.some(r => !incomingIds.has(r.eventId))) throw Error("Previously imported events disappeared from a full-period pull");
    const counts = { received: records.length, changed: 0, unmatched: 0, withheld: 0, projected: 0, lateChanges: 0, boundaryReview: 0, clearedEmployees: 0 };
    const touched = new Set<string>();
    // Read once, then group/sort once; repeated reconciliation is linear apart from sorting.
    const storedEvents = new Map<string, typeof events.$inferSelect>();
    for (let start=0; start<records.length; start+=1000) {
      for (const row of await tx.select().from(events).where(inArray(events.eventId, records.slice(start,start+1000).map(r=>r.eventId)))) storedEvents.set(row.eventId,row);
    }
    const neighborsByEmployee = new Map<string, SourcePunch[]>();
    for (const r of records.filter(r=>r.status==='VALID')) {
      const list=neighborsByEmployee.get(r.employeeId) ?? []; list.push(r); neighborsByEmployee.set(r.employeeId,list);
    }
    const boundaryIds = new Set<string>();
    for (const list of neighborsByEmployee.values()) {
      list.sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt)||a.eventId.localeCompare(b.eventId));
      list.forEach((r,i)=>{const day=manilaWallTime(r.capturedAt).date;
        if(day===period.startDate && r.type==='OUT' && list[i-1]?.type!=='IN' || day===period.endDate && r.type==='IN' && list[i+1]?.type!=='OUT') boundaryIds.add(r.eventId);
      });
    }
    const fileLogs = await tx.select({ employeeId: attendanceRawLogs.employeeId, day: attendanceRawLogs.logDate }).from(attendanceRawLogs).innerJoin(attendanceImportBatches,eq(attendanceImportBatches.id,attendanceRawLogs.batchId)).where(and(eq(attendanceImportBatches.payrollPeriodId,periodId),ne(attendanceImportBatches.sourceFormat, "API")));
    const fileDays = new Set(fileLogs.map(r=>`${r.employeeId}|${r.day}`));
    let batchId: string | undefined;
    for (const punch of records) {
      const old = storedEvents.get(punch.eventId);
      const previous = old?.payload as SourcePunch | undefined;
      if (previous && (previous.capturedAt !== punch.capturedAt || previous.branchId !== punch.branchId || previous.type !== punch.type || previous.originalEmployeeId !== punch.originalEmployeeId)) throw Error("Source event changed immutable capture data");
      if (previous && Date.parse(previous.updatedAt)>Date.parse(punch.updatedAt)) throw Error("A newer source revision was already received");
      const changed = !previous || hash(previous) !== hash(punch);
      if (changed) {
        await tx.insert(events).values({ eventId: punch.eventId, sourceEmployeeId: punch.employeeId, capturedAt: new Date(punch.capturedAt), payload: punch, firstPayload: punch }).onConflictDoUpdate({ target: events.eventId, set: { sourceEmployeeId: punch.employeeId, payload: punch, revision: sql`${events.revision}+1`, seenAt: new Date() } });
        await tx.insert(revisions).values({ eventId: punch.eventId, runId, payload: punch }); counts.changed++;
      }
      const day = manilaWallTime(punch.capturedAt).date;
      const inPeriod = day >= period.startDate && day <= period.endDate;
      const person = mapping.get(punch.employeeId); if (!person && inPeriod && punch.status === "VALID") counts.unmatched++;
      const boundary = boundaryIds.has(punch.eventId);
      if (boundary) counts.boundaryReview++;
      if (inPeriod && punch.status === "VALID" && (!person || punch.clockFlag || !punch.reviewResolved && punch.reviewFlags.length > 0)) counts.withheld++;
      const prior = oldById.get(punch.eventId); const fingerprint = hash([punch, person?.employeeId ?? null]);
      if (prior?.payloadHash === fingerprint) continue;
      if (protectedPeriod) { if(inPeriod)counts.lateChanges++; continue; }
      // Unresolved source review flags stay in the source inbox, never silently paid.
      const eligible = person && punch.status === "VALID" && !punch.clockFlag && (punch.reviewResolved || punch.reviewFlags.length === 0);
      if (prior?.employeeId) touched.add(prior.employeeId); if (person) touched.add(person.employeeId);
      if (prior?.rawLogId) {
        await tx.update(projections).set({ rawLogId: null }).where(and(eq(projections.payrollPeriodId, periodId), eq(projections.eventId, punch.eventId)));
        await tx.delete(attendanceRawLogs).where(eq(attendanceRawLogs.id, prior.rawLogId));
      }
      let rawLogId: number | null = null;
      if (eligible) {
        const wall = manilaWallTime(punch.capturedAt);
        // Transition is explicit: don't double-count any file-imported punches for this employee/day.
        if (fileDays.has(`${person.employeeId}|${wall.date}`)) throw Error("Resolve overlapping file imports before enabling the API source");
        if (!batchId) {
          const name = `attendance-api:${periodId}`;
          const [batch] = await tx.select().from(attendanceImportBatches).where(and(eq(attendanceImportBatches.payrollPeriodId, periodId), eq(attendanceImportBatches.sourceFileName, name), eq(attendanceImportBatches.sourceFormat, "API")));
          batchId = batch?.id;
          if (!batchId) { const [created] = await tx.insert(attendanceImportBatches).values({ payrollPeriodId: periodId, sourceFileName: name, sourceFormat: "API", status: "Processed", notes: "Managed by attendance API reconciliation. Source IDs and revisions are retained in the source inbox." }).returning({ id: attendanceImportBatches.id }); batchId = created.id; }
        }
        const [inserted] = await tx.insert(attendanceRawLogs).values({ batchId, employeeId: person.employeeId, employeeNo: person.employeeNo!, siteCode: punch.branchId, direction: punch.type, loggedAt: sql`${wall.timestamp}::timestamp`, logDate: wall.date, logTime: wall.time, rawText: JSON.stringify(punch), normalizedHash: hash(["attendance-api", punch.eventId]) }).returning({ id: attendanceRawLogs.id }); rawLogId = inserted.id; counts.projected++;
      }
      await tx.insert(projections).values({ payrollPeriodId: periodId, eventId: punch.eventId, rawLogId, employeeId: person?.employeeId ?? null, payloadHash: fingerprint }).onConflictDoUpdate({ target: [projections.payrollPeriodId, projections.eventId], set: { rawLogId, employeeId: person?.employeeId ?? null, payloadHash: fingerprint } });
    }
    if (touched.size) {
      await tx.insert(sourcePeriods).values({ payrollPeriodId: periodId, inputRunId: runId }).onConflictDoUpdate({ target: sourcePeriods.payrollPeriodId, set: { inputRunId: runId } });
      // Clear affected draft summaries (whole period covers overnight pairing and reattribution).
      await tx.delete(attendanceDailySummaries).where(and(inArray(attendanceDailySummaries.employeeId, [...touched]), gte(attendanceDailySummaries.attendanceDate, period.startDate), lte(attendanceDailySummaries.attendanceDate, period.endDate)));
      for (const r of periodRuns.filter(r => ["Draft", "Reviewed", "Approved"].includes(r.status))) {
        await tx.update(payrollRuns).set({ status: "Stale", reviewedAt: null, reviewedByUserId: null, approvedAt: null, approvedByUserId: null, updatedAt: new Date() }).where(eq(payrollRuns.id, r.id));
        await recordPayrollRunEvent({ payrollRunId: r.id, actorUserId, eventType: "MarkedStale", fromStatus: r.status, toStatus: "Stale", notes: "Attendance API input changed; refresh attendance summaries before recomputing payroll.", database: tx });
      }
    }
    const current = await tx.select().from(projections).where(eq(projections.payrollPeriodId, periodId));
    const [managedBatch] = await tx.select({id:attendanceImportBatches.id}).from(attendanceImportBatches).where(and(eq(attendanceImportBatches.payrollPeriodId,periodId),eq(attendanceImportBatches.sourceFileName,`attendance-api:${periodId}`),eq(attendanceImportBatches.sourceFormat,"API")));
    if(managedBatch && !protectedPeriod) {
      const total=current.filter(r=>r.rawLogId!==null).length;
      await tx.update(attendanceImportBatches).set({totalRows:total,matchedRows:total}).where(eq(attendanceImportBatches.id,managedBatch.id));
    }
    counts.clearedEmployees = [...new Set(current.map(r => r.employeeId).filter(Boolean))].filter(id => !current.some(r => r.employeeId === id && r.rawLogId !== null)).length;
    await tx.update(runs).set({ state: "Complete", counts, completedAt: new Date() }).where(eq(runs.id, runId));
    await recordAdminAuditEvent({ actorUserId, entityType: "attendance_source_run", entityId: runId, action: "attendance.api_reconciled", details: { periodId, ...counts }, database: tx });
    return counts;
  });
}
export async function saveAttendanceSourceMapping(database: DbClient, actorUserId: string, sourceEmployeeId: string, employeeId: string, reason: string) {
  requireAttendanceSource();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sourceEmployeeId) || !/^[0-9a-f-]{36}$/.test(employeeId) || !reason.trim() || reason.length > 500) throw new PayrollValidationError("Employee IDs and a verification reason are required");
  // Caller supplies a transaction; all mapping edits serialize with sync and payroll.
  await lockAttendancePayrollInput(database);
  const [person] = await database.select().from(employees).where(eq(employees.id, employeeId)); if (!person || person.deletedAt) throw new PayrollValidationError("Select an active payroll employee");
  const [previous] = await database.select().from(mappings).where(eq(mappings.sourceEmployeeId, sourceEmployeeId));
  const changed = previous?.employeeId !== employeeId;
  await database.insert(mappings).values({ sourceEmployeeId, employeeId, actorUserId, reason }).onConflictDoUpdate({ target: mappings.sourceEmployeeId, set: { employeeId, actorUserId, reason, ...(changed ? { updatedAt: sql`clock_timestamp()` } : {}) } });
  const affectedPeriodIds: string[] = [];
  if (changed) {
    const affected = await database.selectDistinct({ periodId: projections.payrollPeriodId })
      .from(projections).innerJoin(events, eq(events.eventId, projections.eventId))
      .where(eq(events.sourceEmployeeId, sourceEmployeeId));
    for (const { periodId } of affected.sort((a, b) => a.periodId.localeCompare(b.periodId))) {
      const [period] = await database.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId)).for("update");
      const periodRuns = await database.select().from(payrollRuns).where(eq(payrollRuns.payrollPeriodId, periodId)).for("update");
      if (!period || period.status !== "Open" || periodRuns.some(run => run.status === "Posted")) continue;
      affectedPeriodIds.push(periodId);
      await database.update(sourcePeriods).set({ summariesRunId: null }).where(eq(sourcePeriods.payrollPeriodId, periodId));
      for (const run of periodRuns.filter(run => ["Draft", "Reviewed", "Approved"].includes(run.status))) {
        await database.update(payrollRuns).set({ status: "Stale", reviewedAt: null, reviewedByUserId: null, approvedAt: null, approvedByUserId: null, updatedAt: new Date() }).where(eq(payrollRuns.id, run.id));
        await recordPayrollRunEvent({ payrollRunId: run.id, actorUserId, eventType: "MarkedStale", fromStatus: run.status, toStatus: "Stale", notes: "Employee mapping changed. Sync attendance, refresh DTR summaries and recompute payroll.", database });
      }
    }
  }
  await recordAdminAuditEvent({ actorUserId, entityType: "attendance_source_mapping", entityId: sourceEmployeeId, action: "attendance.mapping_saved", details: { employeeId, previousEmployeeId: previous?.employeeId ?? null, reason, changed, affectedPeriodIds }, database });
  return { changed, affectedPeriodIds };
}
