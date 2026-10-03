"use server";
import { revalidatePath } from "next/cache";
import { requireAdminActor } from "@/lib/admin";
import { db } from "@/db";
import { requireAttendanceSource, saveAttendanceSourceMapping, syncAttendanceSourcePeriod } from "@/lib/payroll/attendanceSourceSync";
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
export async function saveAttendanceSourceMappingAction(sourceId: string, employeeId: string, reason: string) {
  const actor = await requireAdminActor(); requireAttendanceSource();
  return payrollActionResult(async () => {
    const result = await db.transaction(tx => saveAttendanceSourceMapping(tx, actor.userId, sourceId, employeeId, reason));
    revalidatePath("/payroll/attendance-source"); revalidatePath("/payroll");
    return result.changed ? `Mapping saved. ${result.affectedPeriodIds.length} open period(s) now require sync, DTR refresh and payroll recomputation.` : "Verified mapping retained. No attendance identity changed.";
  });
}
export async function refreshAttendanceSourceSummariesAction(periodId: string) {
  await requireAdminActor(); requireAttendanceSource();
  return payrollActionResult(async () => {
    const result = await refreshAttendancePeriodSummariesAction(periodId);
    return `${result.summaryCount} DTR summaries refreshed for ${result.employeeCount} employees. Review DTR and resolve remaining source exceptions before computing payroll.`;
  });
}
