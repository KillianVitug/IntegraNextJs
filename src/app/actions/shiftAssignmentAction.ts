"use server";

import { revalidatePath } from "next/cache";
import { assertNoConfirmedScheduleEdit } from "@/lib/scheduling/guards";
import { db } from "@/db";
import {
  employeeShiftAssignments,
  employeeWeeklyShiftPatterns,
} from "@/db/schema";
import {
  recordAdminAuditEvent,
  requireAdminActor,
} from "@/lib/admin";
import {
  requireAuthenticatedUser,
} from "@/lib/auth/server";
import {
  deleteEmployeeShiftAssignmentSchema,
  upsertEmployeeShiftAssignmentSchema,
} from "@/zod-schemas/employeeShiftAssignment";
import { bulkScheduleInput, prepareBulkDaySchedules, saveDateAssignment, saveBulkDaySchedules, bulkScheduleReceipt } from "@/lib/payroll/bulkDaySchedules";
import { PayrollValidationError } from "@/lib/payroll/validation";
import { lockAttendancePayrollInput } from "@/lib/payroll/attendanceSourceGuard";
import { desc, eq } from "drizzle-orm";
import {
  getAffectedScheduleRange,
  getLatestImportedAttendanceDate,
  getRebuildRange,
  lockShiftAssignmentContext,
  markAffectedShiftRunsStale,
  rebuildEmployeeAttendanceSummaries,
  withOvernightScheduleBoundary,
} from "./shiftAssignmentHelpers";

export async function listEmployeeShiftAssignments(employeeId: string) {
  await requireAdminActor();

  return db
    .select()
    .from(employeeShiftAssignments)
    .where(eq(employeeShiftAssignments.employeeId, employeeId))
    .orderBy(desc(employeeShiftAssignments.effectiveFrom), desc(employeeShiftAssignments.id));
}

export async function listEmployeeWeeklyShiftPatterns(employeeId: string) {
  await requireAdminActor();

  const patterns = await db.query.employeeWeeklyShiftPatterns.findMany({
    where: eq(employeeWeeklyShiftPatterns.employeeId, employeeId),
    with: {
      days: true,
    },
  });

  return patterns.sort((left, right) => {
    const fromComparison = right.effectiveFrom.localeCompare(left.effectiveFrom);
    if (fromComparison !== 0) return fromComparison;
    return right.id - left.id;
  });
}

/** Legacy weekly editors are retired; the Schedules workspace owns dated revisions and safeguards. */
export async function saveEmployeeWeeklyShiftPattern(_input: unknown): Promise<never> {
  void _input;
  const auth = await requireAuthenticatedUser();
  if (auth.role !== "ADMIN" && auth.role !== "MANAGER") throw new Error("Forbidden.");
  throw new Error("This weekly schedule editor has moved. Use Schedules (/schedules) to review and save weekly defaults.");
}

export async function deleteEmployeeWeeklyShiftPattern(_input: unknown): Promise<never> {
  void _input;
  const auth = await requireAuthenticatedUser();
  if (auth.role !== "ADMIN" && auth.role !== "MANAGER") throw new Error("Forbidden.");
  throw new Error("This weekly schedule editor has moved. Use Schedules (/schedules) to review and archive weekly defaults.");
}
export async function saveEmployeeShiftAssignment(input: unknown) {
 const actor=await requireAdminActor(),payload=upsertEmployeeShiftAssignmentSchema.parse(input);
 const result=await db.transaction(async tx=>{await lockAttendancePayrollInput(tx);return saveDateAssignment(tx,actor,payload);});
 revalidatePath("/shiftAssignments");return result;
}

export async function previewBulkDaySchedulesAction(input:unknown) {
 await requireAdminActor();return prepareBulkDaySchedules(db,input);
}
export async function getBulkDayScheduleResultAction(requestId:string) {
 const actor=await requireAdminActor();return bulkScheduleReceipt(db,actor.userId,bulkScheduleInput.shape.requestId.parse(requestId));
}
export async function saveBulkDaySchedulesAction(input:unknown,digest:string) {
 const actor=await requireAdminActor();
 try{const data=await saveBulkDaySchedules(actor,input,digest);revalidatePath("/payroll/attendance-source");revalidatePath("/shiftAssignments");return {ok:true as const,data};}
 catch(error){if(error instanceof PayrollValidationError)return {ok:false as const,error:error.message};throw error;}
}

export async function deleteEmployeeShiftAssignment(input: unknown) {
  const actor = await requireAdminActor();
  const payload = deleteEmployeeShiftAssignmentSchema.parse(input);

  const result = await db.transaction(async (tx) => {
    const existingAssignment = await tx.query.employeeShiftAssignments.findFirst({
      where: eq(employeeShiftAssignments.id, payload.id),
    });

    if (!existingAssignment) {
      throw new Error("Shift assignment not found.");
    }

    await lockShiftAssignmentContext(tx, existingAssignment.employeeId);
    await assertNoConfirmedScheduleEdit(tx, {employeeId: existingAssignment.employeeId, startDate: existingAssignment.effectiveFrom, endDate: existingAssignment.effectiveTo});

    const staleRange = await withOvernightScheduleBoundary(tx, {
      employeeId: existingAssignment.employeeId,
      removedAssignmentIds: [existingAssignment.id],
      range: getAffectedScheduleRange({ existingRecord: existingAssignment }),
    });

    if (!staleRange.startDate) {
      throw new Error("Unable to determine the affected shift-assignment date range.");
    }

    await markAffectedShiftRunsStale({
      tx,
      employeeId: existingAssignment.employeeId,
      startDate: staleRange.startDate,
      endDate: staleRange.endDate,
      actorUserId: actor.userId,
    });

    await tx
      .delete(employeeShiftAssignments)
      .where(eq(employeeShiftAssignments.id, payload.id));

    const latestImportedDate = await getLatestImportedAttendanceDate(
      tx,
      existingAssignment.employeeId
    );
    const rebuildRange = getRebuildRange({
      staleRange,
      latestImportedDate,
    });
    const rebuiltSummaryCount = rebuildRange
      ? await rebuildEmployeeAttendanceSummaries({
          tx,
          actorUserId: actor.userId,
          employeeId: existingAssignment.employeeId,
          startDate: rebuildRange.startDate,
          endDate: rebuildRange.endDate,
        })
      : 0;

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "employee_shift_assignment",
      entityId: payload.id,
      action: "employee_shift_assignment.deleted",
      database: tx,
      details: {
        employeeId: existingAssignment.employeeId,
        rebuiltSummaryCount,
        rebuildRange,
      },
    });

    return {
      message: "Shift override deleted.",
      rebuiltSummaryCount,
    };
  });
  revalidatePath("/shiftAssignments");
  return result;
}
