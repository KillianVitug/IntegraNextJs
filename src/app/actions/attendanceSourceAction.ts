"use server";
import { revalidatePath } from "next/cache";
import { requireAdminActor } from "@/lib/admin";
import { db } from "@/db";
import { requireAttendanceSource, saveAttendanceSourceMapping, syncAttendanceSourcePeriod } from "@/lib/payroll/attendanceSourceSync";
export async function syncAttendanceSourceAction(periodId: string) {
  const actor = await requireAdminActor(); requireAttendanceSource();
  const result = await syncAttendanceSourcePeriod(periodId, actor.userId);
  revalidatePath("/payroll/attendance-source"); revalidatePath("/payroll");
  return result;
}
export async function saveAttendanceSourceMappingAction(sourceId: string, employeeId: string, reason: string) {
  const actor = await requireAdminActor(); requireAttendanceSource();
  await db.transaction(tx => saveAttendanceSourceMapping(tx, actor.userId, sourceId, employeeId, reason));
  revalidatePath("/payroll/attendance-source");
}
