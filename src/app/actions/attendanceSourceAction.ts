"use server";
import { revalidatePath } from "next/cache";
import { requireAdminActor } from "@/lib/admin";
import { db } from "@/db";
import { requireAttendanceSource, syncAttendanceSourcePeriod } from "@/lib/payroll/attendanceSourceSync";
import { loadMatchBoard, mutateAttendanceMatching } from "@/lib/payroll/attendanceIdentityWorkflow";
import type { MatchMutation } from "@/lib/payroll/attendanceMatching";
import { PayrollValidationError } from "@/lib/payroll/validation";
import { payrollActionResult } from "@/lib/payroll/validation";
import { refreshAttendancePeriodSummariesAction } from "./attendanceImportAction";
export async function syncAttendanceSourceAction(periodId: string) {
  const actor = await requireAdminActor(); requireAttendanceSource();
  return payrollActionResult(async () => {
    const result = await syncAttendanceSourcePeriod(periodId, actor.userId);
    revalidatePath("/payroll/attendance-source"); revalidatePath("/payroll");
    return `Sync complete: ${result.received} received, ${result.projected} punches updated, ${result.unmatched} unmatched, ${result.withheld} withheld, ${result.boundaryReview} boundary reviews, ${result.clearedEmployees} cleared employee-periods, ${result.lateChanges} late changes. Counts can overlap. Resolve issues, then refresh DTR summaries.`;
  });
}
export async function saveAttendanceSourceMappingAction(sourceId: string, employeeId: string, reason: string, version?: string) {
  const actor = await requireAdminActor(); requireAttendanceSource();
  return payrollActionResult(async () => {
    if (!version) throw new PayrollValidationError("Refresh Attendance connection and review the current identity before saving.");
    const result = await db.transaction(tx => mutateAttendanceMatching(tx, actor.userId, { kind: "Match", items: [{ sourceId, employeeId, version, reviewed: true }], method: "other", note: reason, confirmed: true }));
    revalidatePath("/payroll/attendance-source"); revalidatePath("/payroll");
    return result.message;
  });
}
export async function updateAttendanceMatchingAction(request: MatchMutation) {
  const actor = await requireAdminActor(); requireAttendanceSource();
  return payrollActionResult(async () => {
    const result = await db.transaction(async tx => {
      const change = await mutateAttendanceMatching(tx, actor.userId, request);
      return { message: change.message, batchId: change.batchId, board: await loadMatchBoard(tx) };
    });
    revalidatePath("/payroll/attendance-source"); revalidatePath("/payroll");
    return result;
  });
}
export async function attendanceMatchingHistoryAction(before: string) {
  await requireAdminActor(); requireAttendanceSource();
  return payrollActionResult(async () => {
    const board = await loadMatchBoard(db, before);
    return { history: board.history, historyCursor: board.historyCursor };
  });
}
export async function refreshAttendanceSourceSummariesAction(periodId: string) {
  await requireAdminActor(); requireAttendanceSource();
  return payrollActionResult(async () => {
    const result = await refreshAttendancePeriodSummariesAction(periodId);
    return `${result.summaryCount} DTR summaries refreshed for ${result.employeeCount} employees. Review DTR and resolve remaining source exceptions before computing payroll.`;
  });
}
