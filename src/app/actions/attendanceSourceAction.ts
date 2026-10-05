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
import { loadAttendanceReadiness, proposeAttendanceResolution, reviewAttendanceResolution, applySourceResolution } from "@/lib/payroll/attendanceResolution";
import type { ResolutionRequest } from "@/lib/payroll/attendanceResolutionModel";

export async function attendanceReadinessAction(periodId: string, historyPage = 0) {
  await requireAdminActor(); requireAttendanceSource();
  return payrollActionResult(() => loadAttendanceReadiness(periodId, db, historyPage));
}
export async function proposeAttendanceResolutionAction(request: ResolutionRequest) {
  const actor = await requireAdminActor(); requireAttendanceSource();
  return payrollActionResult(async () => {
    await db.transaction(tx => proposeAttendanceResolution(tx, actor.userId, request));
    revalidatePath("/payroll/attendance-source"); revalidatePath("/payroll");
    return "Proposal saved. Review the original dates, verified times and evidence, then approve. Payroll input is unchanged until approval and sync.";
  });
}
export async function reviewAttendanceResolutionAction(id: string, action: "Approve" | "Reject" | "Reverse", reason: string) {
  const actor = await requireAdminActor(); requireAttendanceSource();
  return payrollActionResult(async () => {
    const result = await db.transaction(tx => reviewAttendanceResolution(tx, actor.userId, id, action, reason));
    const message = result.source ? await applySourceResolution(id, actor.userId, true) : action === "Approve" ? "Approved. Sync this period, refresh DTR, then recompute and review payroll." : action === "Reverse" ? "Reversed. The case is reopened and payroll is stale. Sync and refresh DTR before recomputing." : "Proposal rejected. Review the current evidence before proposing another treatment.";
    revalidatePath("/payroll/attendance-source"); revalidatePath("/payroll"); return message;
  });
}
export async function retryAttendanceSourceCorrectionAction(id: string) {
  const actor = await requireAdminActor(); requireAttendanceSource();
  return payrollActionResult(async () => {
    const message = await applySourceResolution(id, actor.userId);
    revalidatePath("/payroll/attendance-source"); revalidatePath("/payroll"); return message;
  });
}
export async function syncAttendanceSourceAction(periodId: string) {
  const actor = await requireAdminActor(); requireAttendanceSource();
  return payrollActionResult(async () => {
    const result = await syncAttendanceSourcePeriod(periodId, actor.userId);
    revalidatePath("/payroll/attendance-source"); revalidatePath("/payroll");
    const duplicates=result.duplicateHandled ? ` ${result.duplicateHandled} duplicate group(s) handled automatically; inspect their history.` : "";
    if(result.duplicateSyncPending)return `Duplicate corrections were confirmed, but the follow-up sync did not finish.${duplicates} Sync this period again before refreshing DTR. Payroll was not recomputed.`;
    return `Sync complete: ${result.received} received, ${result.projected} punches updated, ${result.unmatched} unmatched, ${result.withheld} withheld, ${result.boundaryReview} boundary reviews, ${result.clearedEmployees} cleared employee-periods, ${result.lateChanges} late changes. Counts can overlap.${duplicates} Resolve issues, then refresh DTR summaries.`;
  });
}
export async function saveAttendanceSourceMappingAction(sourceId: string, employeeId: string, reason: string, version?: string, nameDifferencesAcknowledged = false) {
  const actor = await requireAdminActor(); requireAttendanceSource();
  return payrollActionResult(async () => {
    if (!version) throw new PayrollValidationError("Refresh Attendance connection and review the current identity before saving.");
    const result = await db.transaction(tx => mutateAttendanceMatching(tx, actor.userId, { kind: "Match", items: [{ sourceId, employeeId, version, reviewed: true }], method: "other", note: reason, confirmed: true, nameDifferencesAcknowledged }));
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
