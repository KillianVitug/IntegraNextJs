"use server";

import { revalidatePath } from "next/cache";
import { assertNoConfirmedScheduleEdit } from "@/lib/scheduling/guards";
import { db } from "@/db";
import {
  employeeShiftAssignments,
  employeeWeeklyShiftPatterns,
  employeeWeeklyShiftPatternDays,
} from "@/db/schema";
import {
  recordAdminAuditEvent,
  requireAdminActor,
} from "@/lib/admin";
import {
  assertManagerCanAccessEmployee,
  requireAuthenticatedUser,
} from "@/lib/auth/server";
import {
  deleteEmployeeShiftAssignmentSchema,
  upsertEmployeeShiftAssignmentSchema,
} from "@/zod-schemas/employeeShiftAssignment";
import {
  deleteEmployeeWeeklyShiftPatternSchema,
  upsertEmployeeWeeklyShiftPatternSchema,
} from "@/zod-schemas/employeeWeeklyShiftPattern";
import { bulkScheduleInput, prepareBulkDaySchedules, saveDateAssignment, saveBulkDaySchedules, bulkScheduleReceipt } from "@/lib/payroll/bulkDaySchedules";
import { PayrollValidationError } from "@/lib/payroll/validation";
import { lockAttendancePayrollInput } from "@/lib/payroll/attendanceSourceGuard";
import { desc, eq } from "drizzle-orm";
import {
  buildWeeklyPatternDayValues,
  getAffectedScheduleRange,
  getLatestImportedAttendanceDate,
  getRebuildRange,
  loadShiftTablesById,
  lockShiftAssignmentContext,
  markAffectedShiftRunsStale,
  normalizeEffectiveTo,
  rebuildEmployeeAttendanceSummaries,
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

export async function saveEmployeeWeeklyShiftPattern(input: unknown) {
  const auth = await requireAuthenticatedUser();
  const payload = upsertEmployeeWeeklyShiftPatternSchema.parse(input);

  if (auth.role === "MANAGER") {
    await assertManagerCanAccessEmployee({
      accountId: auth.accountId,
      employeeId: payload.employeeId,
    });
  } else if (auth.role !== "ADMIN") {
    throw new Error("Forbidden.");
  }

  const actor = { userId: auth.accountId, email: auth.email };

  const result = await db.transaction(async (tx) => {
    await lockShiftAssignmentContext(tx, payload.employeeId);

    const existingPattern = payload.id
      ? await tx.query.employeeWeeklyShiftPatterns.findFirst({
          where: eq(employeeWeeklyShiftPatterns.id, payload.id),
          with: {
            days: true,
          },
        })
      : null;

    if (payload.id && !existingPattern) {
      throw new Error("Weekly schedule not found.");
    }

    if (existingPattern && existingPattern.employeeId !== payload.employeeId) {
      throw new Error("Weekly schedule employee mismatch.");
    }

    const effectiveTo = normalizeEffectiveTo(payload.effectiveTo);
    const normalizedPayload = {
      ...payload,
      effectiveTo,
    };

    const shiftTablesById = await loadShiftTablesById(
      tx,
      normalizedPayload.days
        .map((day) => day.shiftTableId)
        .filter((shiftTableId): shiftTableId is number => Boolean(shiftTableId))
    );
    const staleRange = getAffectedScheduleRange({
      existingRecord: existingPattern,
      nextAssignment: {
        effectiveFrom: normalizedPayload.effectiveFrom,
        effectiveTo,
      },
    });

    if (!staleRange.startDate) {
      throw new Error("Unable to determine the affected weekly-schedule date range.");
    }

    await markAffectedShiftRunsStale({
      tx,
      employeeId: payload.employeeId,
      startDate: staleRange.startDate,
      endDate: staleRange.endDate,
      actorUserId: actor.userId,
    });

    let patternId = payload.id ?? null;
    let action = "employee_weekly_shift_pattern.created";

    if (payload.id) {
      await tx
        .update(employeeWeeklyShiftPatterns)
        .set({
          effectiveFrom: normalizedPayload.effectiveFrom,
          effectiveTo,
          updatedAt: new Date(),
        })
        .where(eq(employeeWeeklyShiftPatterns.id, payload.id));
      await tx
        .delete(employeeWeeklyShiftPatternDays)
        .where(eq(employeeWeeklyShiftPatternDays.patternId, payload.id));
      patternId = payload.id;
      action = "employee_weekly_shift_pattern.updated";
    } else {
      const [created] = await tx
        .insert(employeeWeeklyShiftPatterns)
        .values({
          employeeId: payload.employeeId,
          effectiveFrom: normalizedPayload.effectiveFrom,
          effectiveTo,
        })
        .returning({ id: employeeWeeklyShiftPatterns.id });
      patternId = created.id;
    }

    if (patternId == null) {
      throw new Error("Weekly schedule could not be saved.");
    }

    const dayValues = buildWeeklyPatternDayValues({
      patternId,
      days: normalizedPayload.days,
      shiftTablesById,
    });
    if (dayValues.length > 0) {
      await tx.insert(employeeWeeklyShiftPatternDays).values(dayValues);
    }

    const latestImportedDate = await getLatestImportedAttendanceDate(tx, payload.employeeId);
    const rebuildRange = getRebuildRange({
      staleRange,
      latestImportedDate,
    });
    const rebuiltSummaryCount = rebuildRange
      ? await rebuildEmployeeAttendanceSummaries({
          tx,
          employeeId: payload.employeeId,
          startDate: rebuildRange.startDate,
          endDate: rebuildRange.endDate,
        })
      : 0;

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "employee_weekly_shift_pattern",
      entityId: patternId,
      action,
      database: tx,
      details: {
        employeeId: payload.employeeId,
        rebuiltSummaryCount,
        rebuildRange,
        effectiveFrom: normalizedPayload.effectiveFrom,
        effectiveTo,
        days: normalizedPayload.days.map((day) => ({
          weekday: day.weekday,
          shiftTableId: day.shiftTableId,
        })),
      },
    });

    return {
      message: payload.id ? "Weekly schedule updated." : "Weekly schedule created.",
      patternId,
      rebuiltSummaryCount,
    };
  });
  revalidatePath("/weeklyShiftPatterns");
  return result;
}

export async function deleteEmployeeWeeklyShiftPattern(input: unknown) {
  const auth = await requireAuthenticatedUser();
  const payload = deleteEmployeeWeeklyShiftPatternSchema.parse(input);

  const result = await db.transaction(async (tx) => {
    const existingPattern = await tx.query.employeeWeeklyShiftPatterns.findFirst({
      where: eq(employeeWeeklyShiftPatterns.id, payload.id),
      with: {
        days: true,
      },
    });

    if (!existingPattern) {
      throw new Error("Weekly schedule not found.");
    }

    if (auth.role === "MANAGER") {
      await assertManagerCanAccessEmployee({
        accountId: auth.accountId,
        employeeId: existingPattern.employeeId,
        database: tx,
      });
    } else if (auth.role !== "ADMIN") {
      throw new Error("Forbidden.");
    }

    const actor = { userId: auth.accountId, email: auth.email };

    await lockShiftAssignmentContext(tx, existingPattern.employeeId);

    const staleRange = getAffectedScheduleRange({
      existingRecord: existingPattern,
    });

    if (!staleRange.startDate) {
      throw new Error("Unable to determine the affected weekly-schedule date range.");
    }

    await markAffectedShiftRunsStale({
      tx,
      employeeId: existingPattern.employeeId,
      startDate: staleRange.startDate,
      endDate: staleRange.endDate,
      actorUserId: actor.userId,
    });

    await tx
      .delete(employeeWeeklyShiftPatterns)
      .where(eq(employeeWeeklyShiftPatterns.id, payload.id));

    const latestImportedDate = await getLatestImportedAttendanceDate(
      tx,
      existingPattern.employeeId
    );
    const rebuildRange = getRebuildRange({
      staleRange,
      latestImportedDate,
    });
    const rebuiltSummaryCount = rebuildRange
      ? await rebuildEmployeeAttendanceSummaries({
          tx,
          employeeId: existingPattern.employeeId,
          startDate: rebuildRange.startDate,
          endDate: rebuildRange.endDate,
        })
      : 0;

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "employee_weekly_shift_pattern",
      entityId: payload.id,
      action: "employee_weekly_shift_pattern.deleted",
      database: tx,
      details: {
        employeeId: existingPattern.employeeId,
        rebuiltSummaryCount,
        rebuildRange,
      },
    });

    return {
      message: "Weekly schedule deleted.",
      rebuiltSummaryCount,
    };
  });
  revalidatePath("/weeklyShiftPatterns");
  return result;
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

    const staleRange = getAffectedScheduleRange({
      existingRecord: existingAssignment,
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
