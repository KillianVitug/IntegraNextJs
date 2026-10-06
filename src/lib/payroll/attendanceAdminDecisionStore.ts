import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import { attendanceImportBatches, attendanceRawLogs } from "@/db/schema";
import { workExclusions, workRawLogs, workTreatments } from "@/db/attendanceWorkbenchSchema";
import { resolutionDigest } from "./attendanceResolution";
import { manilaWallTime } from "./attendanceSourceClient";
import type { WorkDraft, WorkRecord } from "./attendanceWorkbenchModel";
import { workDate } from "./attendanceWorkbenchModel";
import type { AdminAttendanceDecision } from "./attendanceAdminDecision";

/** Called only in the locked approval transaction. Never rewrites original captures. */
export async function persistAdminDecision(tx: DbClient, args: {
  periodId: string; planId: string; actor: string; employeeNo: string;
  draft: WorkDraft; records: WorkRecord[]; sourceRecords: WorkRecord[]; warnings: string[];
}) {
  const { periodId, planId, actor, draft } = args;
  const days = [...new Set([...draft.days, ...args.records.map(r => workDate(r.at)), ...args.sourceRecords.map(r => workDate(r.at))])].sort();
  const decision: AdminAttendanceDecision = {
    kind: "AdminDecision", actor, approvedAt: new Date().toISOString(), reason: draft.reason,
    warnings: args.warnings, days, records: args.records, sourceRecords: args.sourceRecords,
  };
  const prior = await tx.select({ id: attendanceRawLogs.id }).from(attendanceRawLogs)
    .innerJoin(attendanceImportBatches, eq(attendanceImportBatches.id, attendanceRawLogs.batchId))
    .where(and(eq(attendanceImportBatches.payrollPeriodId, periodId), eq(attendanceRawLogs.employeeId, draft.employeeId), inArray(attendanceRawLogs.logDate, days)));
  if (prior.length) await tx.insert(workExclusions).values(prior.map(r => ({ rawLogId: r.id, planId, reason: draft.reason || "Approved attendance decision", active: true })))
    .onConflictDoUpdate({ target: workExclusions.rawLogId, set: { planId, reason: draft.reason || "Approved attendance decision", active: true } });
  const [batch] = await tx.insert(attendanceImportBatches).values({
    payrollPeriodId: periodId, sourceFileName: `admin-decision:${planId}:${periodId}`,
    sourceFormat: "API", status: "Processed", notes: "Administrator-approved payroll attendance; original captures retained",
  }).returning({ id: attendanceImportBatches.id });
  const effective = args.records.filter(r => r.employeeId === draft.employeeId && r.status === "VALID" && !r.excluded && r.type !== "UNSPECIFIED");
  for (const record of effective) {
    const wall = manilaWallTime(record.at);
    const [row] = await tx.insert(attendanceRawLogs).values({
      batchId: batch.id, employeeId: draft.employeeId, employeeNo: args.employeeNo,
      direction: record.type, loggedAt: sql`${wall.timestamp}::timestamp`, logDate: wall.date, logTime: wall.time,
      rawText: JSON.stringify({ source: "ADMIN_DECISION", planId, recordId: record.id }),
      normalizedHash: resolutionDigest(["admin-decision", planId, periodId, record.id]),
    }).returning({ id: attendanceRawLogs.id });
    if(record.source==="Manual")record.rawLogId=row.id;
    await tx.insert(workRawLogs).values({ planId, changeId: `${periodId}:${record.id}`, rawLogId: row.id });
  }
  await tx.update(workTreatments).set({ active: false }).where(and(eq(workTreatments.periodId, periodId), eq(workTreatments.employeeId, draft.employeeId), inArray(workTreatments.day, days)));
  await tx.insert(workTreatments).values(days.map(day => ({ planId, periodId, employeeId: draft.employeeId, day, version: resolutionDigest(decision), payload: decision })));
}
