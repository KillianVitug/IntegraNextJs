"use server";

import { revalidatePath } from "next/cache";
import { addDays, format } from "date-fns";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import {
  accountCode,
  branchCalendarAccountCodeOverrides,
  branchCalendarScheduleOverrideBatches,
  branchCalendarScheduleOverrideItems,
  type BranchCalendarScheduleOverrideAssignmentSnapshot,
  employeeShiftAssignments,
  employees,
  holidayYearCalendar,
  payrollPeriods,
  payrollRuns,
} from "@/db/schema";
import { recordAdminAuditEvent, requireAdminActor } from "@/lib/admin";
import { buildShiftAssignmentSnapshotFromTable } from "@/lib/shifts";
import {
  getLatestImportedAttendanceDate,
  getRebuildRange,
  loadShiftTableForAssignment,
  lockShiftAssignmentContext,
  markAffectedShiftRunsStale,
  rebuildEmployeeAttendanceSummaries,
} from "@/app/actions/shiftAssignmentHelpers";
import {
  refreshGeneratedDtrRowsForBranchCalendarAccountCodeOverride,
  refreshGeneratedDtrRowsForHolidayCalendarChange,
} from "@/app/actions/attendanceImportAction";
import {
  clearBranchCalendarAccountCodeOverrideSchema,
  revertBranchCalendarScheduleOverrideSchema,
  revertBranchCalendarScheduleOverridesSchema,
  saveBranchCalendarScheduleOverrideSchema,
  saveBranchCalendarHolidayCheckDatesSchema,
  saveBranchCalendarAccountCodeOverrideSchema,
} from "@/zod-schemas/branchCalendarAccountCodeOverride";

const BRANCH_CALENDAR_ACCOUNT_CODE_TYPES = [
  "Regular Hours",
  "Overtime",
  "Night Premium",
  "Sunday/Holiday",
] as const;

type ShiftAssignmentRow = typeof employeeShiftAssignments.$inferSelect;
type ShiftAssignmentInsert = typeof employeeShiftAssignments.$inferInsert;
type BranchCalendarScheduleMutationType =
  | "created"
  | "updated_exact"
  | "split_start"
  | "split_end"
  | "split_middle";

function scopeLabel(departmentId: number | null) {
  return departmentId == null ? "All Departments" : `department ${departmentId}`;
}

function parseDateKey(value: string) {
  return new Date(`${value}T00:00:00`);
}

function addDateKeyDays(value: string, days: number) {
  return format(addDays(parseDateKey(value), days), "yyyy-MM-dd");
}

function getDayName(value: string) {
  return format(parseDateKey(value), "EEEE") as ShiftAssignmentRow["restDay"];
}

function cloneAssignmentForInsert(
  assignment: ShiftAssignmentRow,
  range: { effectiveFrom: string; effectiveTo: string | null }
): ShiftAssignmentInsert {
  return {
    employeeId: assignment.employeeId,
    shiftTableId: assignment.shiftTableId,
    shiftName: assignment.shiftName,
    shiftCode: assignment.shiftCode,
    shiftSchedule: assignment.shiftSchedule,
    effectiveFrom: range.effectiveFrom,
    effectiveTo: range.effectiveTo,
    checkInTime: assignment.checkInTime,
    checkOutTime: assignment.checkOutTime,
    breakMinutes: assignment.breakMinutes,
    paidBreakMinutes: assignment.paidBreakMinutes,
    graceMinutes: assignment.graceMinutes,
    restDay: assignment.restDay,
    hoursPerDay: assignment.hoursPerDay,
    isFlexible: assignment.isFlexible,
  };
}

function buildAssignmentSnapshot(
  assignment: ShiftAssignmentRow
): BranchCalendarScheduleOverrideAssignmentSnapshot {
  return {
    id: assignment.id,
    employeeId: assignment.employeeId,
    shiftTableId: assignment.shiftTableId,
    shiftName: assignment.shiftName,
    shiftCode: assignment.shiftCode,
    shiftSchedule: assignment.shiftSchedule,
    effectiveFrom: assignment.effectiveFrom,
    effectiveTo: assignment.effectiveTo,
    checkInTime: assignment.checkInTime,
    checkOutTime: assignment.checkOutTime,
    breakMinutes: assignment.breakMinutes,
    paidBreakMinutes: assignment.paidBreakMinutes,
    graceMinutes: assignment.graceMinutes,
    restDay: assignment.restDay,
    hoursPerDay: assignment.hoursPerDay,
    isFlexible: assignment.isFlexible,
  };
}

function buildRestDayAssignmentValues(args: {
  employeeId: string;
  attendanceDate: string;
  graceMinutes: number;
  isFlexible: boolean;
}): ShiftAssignmentInsert {
  return {
    employeeId: args.employeeId,
    shiftTableId: null,
    shiftName: "Rest / Off day",
    shiftCode: "REST",
    shiftSchedule: null,
    effectiveFrom: args.attendanceDate,
    effectiveTo: args.attendanceDate,
    checkInTime: "00:00",
    checkOutTime: "00:00",
    breakMinutes: 0,
    paidBreakMinutes: 0,
    graceMinutes: args.graceMinutes,
    restDay: getDayName(args.attendanceDate),
    hoursPerDay: "0.00",
    isFlexible: args.isFlexible,
  };
}

async function replaceAssignmentForOneDay(args: {
  tx: DbClient;
  existingAssignment: ShiftAssignmentRow | null;
  values: ShiftAssignmentInsert;
  attendanceDate: string;
}) {
  const replacedAssignmentIds = args.existingAssignment
    ? [args.existingAssignment.id]
    : [];
  const attendanceDate = args.attendanceDate;

  if (!args.existingAssignment) {
    const [created] = await args.tx
      .insert(employeeShiftAssignments)
      .values(args.values)
      .returning({ id: employeeShiftAssignments.id });

    return {
      assignmentId: created.id,
      replacedAssignmentIds,
      mutationType: "created" as BranchCalendarScheduleMutationType,
      retainedAssignmentId: null,
      afterFragmentAssignmentId: null,
    };
  }

  const existing = args.existingAssignment;
  const startsOnDate = existing.effectiveFrom === attendanceDate;
  const endsOnDate = existing.effectiveTo === attendanceDate;
  const isExactDay = startsOnDate && endsOnDate;

  if (isExactDay) {
    await args.tx
      .update(employeeShiftAssignments)
      .set({
        ...args.values,
        updatedAt: new Date(),
      })
      .where(eq(employeeShiftAssignments.id, existing.id));

    return {
      assignmentId: existing.id,
      replacedAssignmentIds,
      mutationType: "updated_exact" as BranchCalendarScheduleMutationType,
      retainedAssignmentId: null,
      afterFragmentAssignmentId: null,
    };
  }

  const nextDate = addDateKeyDays(attendanceDate, 1);
  const previousDate = addDateKeyDays(attendanceDate, -1);
  let mutationType: BranchCalendarScheduleMutationType;
  let afterFragmentAssignmentId: number | null = null;

  if (startsOnDate) {
    await args.tx
      .update(employeeShiftAssignments)
      .set({
        effectiveFrom: nextDate,
        updatedAt: new Date(),
      })
      .where(eq(employeeShiftAssignments.id, existing.id));
    mutationType = "split_start";
  } else {
    await args.tx
      .update(employeeShiftAssignments)
      .set({
        effectiveTo: previousDate,
        updatedAt: new Date(),
      })
      .where(eq(employeeShiftAssignments.id, existing.id));

    if (!endsOnDate) {
      const [afterFragment] = await args.tx.insert(employeeShiftAssignments).values(
        cloneAssignmentForInsert(existing, {
          effectiveFrom: nextDate,
          effectiveTo: existing.effectiveTo,
        })
      ).returning({ id: employeeShiftAssignments.id });
      afterFragmentAssignmentId = afterFragment.id;
      mutationType = "split_middle";
    } else {
      mutationType = "split_end";
    }
  }

  const [created] = await args.tx
    .insert(employeeShiftAssignments)
    .values(args.values)
    .returning({ id: employeeShiftAssignments.id });

  return {
    assignmentId: created.id,
    replacedAssignmentIds,
    mutationType,
    retainedAssignmentId: existing.id,
    afterFragmentAssignmentId,
  };
}

async function clearAssignmentCoverageForDate(args: {
  tx: DbClient;
  assignment: ShiftAssignmentRow;
  attendanceDate: string;
}) {
  const { assignment, attendanceDate, tx } = args;
  const startsOnDate = assignment.effectiveFrom === attendanceDate;
  const endsOnDate = assignment.effectiveTo === attendanceDate;
  const nextDate = addDateKeyDays(attendanceDate, 1);
  const previousDate = addDateKeyDays(attendanceDate, -1);

  if (startsOnDate && endsOnDate) {
    await tx
      .delete(employeeShiftAssignments)
      .where(eq(employeeShiftAssignments.id, assignment.id));

    return {
      deletedAssignmentIds: [assignment.id],
      trimmedAssignmentIds: [] as number[],
      createdFragmentIds: [] as number[],
    };
  }

  if (startsOnDate) {
    await tx
      .update(employeeShiftAssignments)
      .set({
        effectiveFrom: nextDate,
        updatedAt: new Date(),
      })
      .where(eq(employeeShiftAssignments.id, assignment.id));

    return {
      deletedAssignmentIds: [] as number[],
      trimmedAssignmentIds: [assignment.id],
      createdFragmentIds: [] as number[],
    };
  }

  if (endsOnDate) {
    await tx
      .update(employeeShiftAssignments)
      .set({
        effectiveTo: previousDate,
        updatedAt: new Date(),
      })
      .where(eq(employeeShiftAssignments.id, assignment.id));

    return {
      deletedAssignmentIds: [] as number[],
      trimmedAssignmentIds: [assignment.id],
      createdFragmentIds: [] as number[],
    };
  }

  await tx
    .update(employeeShiftAssignments)
    .set({
      effectiveTo: previousDate,
      updatedAt: new Date(),
    })
    .where(eq(employeeShiftAssignments.id, assignment.id));

  const [afterFragment] = await tx
    .insert(employeeShiftAssignments)
    .values(
      cloneAssignmentForInsert(assignment, {
        effectiveFrom: nextDate,
        effectiveTo: assignment.effectiveTo,
      })
    )
    .returning({ id: employeeShiftAssignments.id });

  return {
    deletedAssignmentIds: [] as number[],
    trimmedAssignmentIds: [assignment.id],
    createdFragmentIds: [afterFragment.id],
  };
}

async function loadAssignmentSnapshotsById(tx: DbClient, assignmentIds: number[]) {
  const uniqueIds = [...new Set(assignmentIds)].filter((id) => id > 0);
  if (uniqueIds.length === 0) {
    return new Map<number, BranchCalendarScheduleOverrideAssignmentSnapshot>();
  }

  const rows = await tx
    .select()
    .from(employeeShiftAssignments)
    .where(inArray(employeeShiftAssignments.id, uniqueIds));

  return new Map(
    rows.map((row) => [row.id, buildAssignmentSnapshot(row)] as const)
  );
}

function buildOverrideWhere(args: {
  attendanceDate: string;
  departmentId: number | null;
}) {
  return and(
    eq(branchCalendarAccountCodeOverrides.attendanceDate, args.attendanceDate),
    args.departmentId == null
      ? isNull(branchCalendarAccountCodeOverrides.departmentId)
      : eq(branchCalendarAccountCodeOverrides.departmentId, args.departmentId)
  );
}

async function assertAccountCodeTypes(args: {
  regularAccountCodeId: number;
  overtimeAccountCodeId: number;
}) {
  if (args.regularAccountCodeId === args.overtimeAccountCodeId) {
    throw new Error("Select separate account codes for regular hours and overtime.");
  }

  const rows = await db
    .select({
      id: accountCode.id,
      accountCode: accountCode.accountCode,
      accountType: accountCode.accountType,
    })
    .from(accountCode)
    .where(
      inArray(accountCode.id, [
        args.regularAccountCodeId,
        args.overtimeAccountCodeId,
      ])
    );

  const accountById = new Map(rows.map((row) => [row.id, row] as const));
  const regularAccount = accountById.get(args.regularAccountCodeId);
  const overtimeAccount = accountById.get(args.overtimeAccountCodeId);

  if (!regularAccount) {
    throw new Error("Selected regular-hours account code no longer exists.");
  }
  if (!overtimeAccount) {
    throw new Error("Selected overtime account code no longer exists.");
  }
  if (
    !BRANCH_CALENDAR_ACCOUNT_CODE_TYPES.includes(
      regularAccount.accountType as (typeof BRANCH_CALENDAR_ACCOUNT_CODE_TYPES)[number]
    )
  ) {
    throw new Error(
      "Regular-hours account code must be Regular Hours, Overtime, Night Premium, or Sunday/Holiday."
    );
  }
  if (
    !BRANCH_CALENDAR_ACCOUNT_CODE_TYPES.includes(
      overtimeAccount.accountType as (typeof BRANCH_CALENDAR_ACCOUNT_CODE_TYPES)[number]
    )
  ) {
    throw new Error(
      "Overtime account code must be Regular Hours, Overtime, Night Premium, or Sunday/Holiday."
    );
  }
}

async function assertAffectedPayrollRunsAreEditable(attendanceDate: string) {
  const affectedPeriods = await db
    .select({
      id: payrollPeriods.id,
      code: payrollPeriods.code,
    })
    .from(payrollPeriods)
    .where(
      and(
        eq(payrollPeriods.status, "Open"),
        lte(payrollPeriods.startDate, attendanceDate),
        gte(payrollPeriods.endDate, attendanceDate)
      )
    );

  if (affectedPeriods.length === 0) return;

  const blockingRuns = await db
    .select({
      periodCode: payrollPeriods.code,
      status: payrollRuns.status,
    })
    .from(payrollRuns)
    .innerJoin(payrollPeriods, eq(payrollRuns.payrollPeriodId, payrollPeriods.id))
    .where(
      and(
        inArray(
          payrollRuns.payrollPeriodId,
          affectedPeriods.map((period) => period.id)
        ),
        inArray(payrollRuns.status, ["Approved", "Posted"])
      )
    )
    .orderBy(desc(payrollRuns.createdAt));

  const blockingRun = blockingRuns[0];
  if (blockingRun) {
    throw new Error(
      `Branch Calendar account-code changes are blocked because payroll period ${blockingRun.periodCode} already has a ${blockingRun.status} run.`
    );
  }
}

export async function saveBranchCalendarAccountCodeOverrideAction(input: unknown) {
  const actor = await requireAdminActor();
  const parsed = saveBranchCalendarAccountCodeOverrideSchema.parse(input);
  const departmentId = parsed.departmentId ?? null;

  await assertAccountCodeTypes(parsed);
  await assertAffectedPayrollRunsAreEditable(parsed.attendanceDate);

  const saved = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: branchCalendarAccountCodeOverrides.id })
      .from(branchCalendarAccountCodeOverrides)
      .where(
        buildOverrideWhere({
          attendanceDate: parsed.attendanceDate,
          departmentId,
        })
      )
      .limit(1);

    if (existing) {
      await tx
        .update(branchCalendarAccountCodeOverrides)
        .set({
          regularAccountCodeId: parsed.regularAccountCodeId,
          overtimeAccountCodeId: parsed.overtimeAccountCodeId,
          updatedByUserId: actor.userId,
          updatedAt: new Date(),
        })
        .where(eq(branchCalendarAccountCodeOverrides.id, existing.id));

      return { id: existing.id, created: false };
    }

    const [created] = await tx
      .insert(branchCalendarAccountCodeOverrides)
      .values({
        attendanceDate: parsed.attendanceDate,
        departmentId,
        regularAccountCodeId: parsed.regularAccountCodeId,
        overtimeAccountCodeId: parsed.overtimeAccountCodeId,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      })
      .returning({ id: branchCalendarAccountCodeOverrides.id });

    return { id: created.id, created: true };
  });

  const refreshResult =
    await refreshGeneratedDtrRowsForBranchCalendarAccountCodeOverride({
      actorUserId: actor.userId,
      attendanceDate: parsed.attendanceDate,
      departmentId,
    });

  await recordAdminAuditEvent({
    actorUserId: actor.userId,
    entityType: "branch_calendar_account_code_override",
    entityId: saved.id,
    action: saved.created
      ? "branch_calendar_account_code.created"
      : "branch_calendar_account_code.updated",
    details: {
      attendanceDate: parsed.attendanceDate,
      departmentId,
      regularAccountCodeId: parsed.regularAccountCodeId,
      overtimeAccountCodeId: parsed.overtimeAccountCodeId,
      refreshResult,
    },
  });

  revalidatePath("/branchCalendar");
  revalidatePath("/payroll");

  return {
    message: `Account codes saved for ${parsed.attendanceDate} (${scopeLabel(
      departmentId
    )}).`,
    ...refreshResult,
  };
}

export async function clearBranchCalendarAccountCodeOverrideAction(input: unknown) {
  const actor = await requireAdminActor();
  const parsed = clearBranchCalendarAccountCodeOverrideSchema.parse(input);
  const departmentId = parsed.departmentId ?? null;

  await assertAffectedPayrollRunsAreEditable(parsed.attendanceDate);

  const deletedRows = await db
    .delete(branchCalendarAccountCodeOverrides)
    .where(
      buildOverrideWhere({
        attendanceDate: parsed.attendanceDate,
        departmentId,
      })
    )
    .returning({ id: branchCalendarAccountCodeOverrides.id });

  const refreshResult =
    await refreshGeneratedDtrRowsForBranchCalendarAccountCodeOverride({
      actorUserId: actor.userId,
      attendanceDate: parsed.attendanceDate,
      departmentId,
    });

  await recordAdminAuditEvent({
    actorUserId: actor.userId,
    entityType: "branch_calendar_account_code_override",
    entityId:
      deletedRows.length > 0
        ? deletedRows.map((row) => row.id).join(",")
        : `${parsed.attendanceDate}:${departmentId ?? "all"}`,
    action: "branch_calendar_account_code.cleared",
    details: {
      attendanceDate: parsed.attendanceDate,
      departmentId,
      deletedCount: deletedRows.length,
      refreshResult,
    },
  });

  revalidatePath("/branchCalendar");
  revalidatePath("/payroll");

  return {
    message: `Account codes cleared for ${parsed.attendanceDate} (${scopeLabel(
      departmentId
    )}).`,
    ...refreshResult,
  };
}

export async function saveBranchCalendarScheduleOverrideAction(input: unknown) {
  const actor = await requireAdminActor();
  const parsed = saveBranchCalendarScheduleOverrideSchema.parse(input);
  const employeeIds = [...new Set(parsed.employeeIds)];

  const employeeRows = await db
    .select({
      id: employees.id,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
    })
    .from(employees)
    .where(and(inArray(employees.id, employeeIds), isNull(employees.deletedAt)));

  if (employeeRows.length !== employeeIds.length) {
    throw new Error("One or more selected employees no longer exist.");
  }

  const employeeLabelById = new Map(
    employeeRows.map((employee) => [
      employee.id,
      `${employee.lastName}, ${employee.firstName}`,
    ])
  );

  const result = await db.transaction(async (tx) => {
    const selectedShiftTable = parsed.shiftTableId
      ? await loadShiftTableForAssignment(tx, parsed.shiftTableId)
      : null;
    const selectedShiftSnapshot = selectedShiftTable
      ? buildShiftAssignmentSnapshotFromTable(selectedShiftTable)
      : null;
    const [batch] = await tx
      .insert(branchCalendarScheduleOverrideBatches)
      .values({
        attendanceDate: parsed.attendanceDate,
        mode: parsed.mode,
        shiftTableId: parsed.shiftTableId ?? null,
        createdByUserId: actor.userId,
      })
      .returning({ id: branchCalendarScheduleOverrideBatches.id });
    const changedAssignmentIds: number[] = [];
    const replacedAssignmentIds: number[] = [];
    const revertItemIds: string[] = [];
    let rebuiltSummaryCount = 0;

    for (const employeeId of employeeIds) {
      await lockShiftAssignmentContext(tx, employeeId);

      const overlappingAssignments = await tx
        .select()
        .from(employeeShiftAssignments)
        .where(
          and(
            eq(employeeShiftAssignments.employeeId, employeeId),
            lte(employeeShiftAssignments.effectiveFrom, parsed.attendanceDate),
            or(
              isNull(employeeShiftAssignments.effectiveTo),
              gte(employeeShiftAssignments.effectiveTo, parsed.attendanceDate)
            )
          )
        )
        .orderBy(asc(employeeShiftAssignments.effectiveFrom), asc(employeeShiftAssignments.id));

      if (overlappingAssignments.length > 1) {
        throw new Error(
          `${
            employeeLabelById.get(employeeId) ?? employeeId
          } has multiple shift overrides covering ${parsed.attendanceDate}. Resolve the overlap in Shift Overrides first.`
        );
      }

      const existingAssignment = overlappingAssignments[0] ?? null;
      const previousAssignmentSnapshot = existingAssignment
        ? buildAssignmentSnapshot(existingAssignment)
        : null;
      const scheduleValues: ShiftAssignmentInsert =
        parsed.mode === "REST_DAY"
          ? buildRestDayAssignmentValues({
              employeeId,
              attendanceDate: parsed.attendanceDate,
              graceMinutes: parsed.graceMinutes,
              isFlexible: parsed.isFlexible,
            })
          : {
              employeeId,
              shiftTableId: parsed.shiftTableId,
              shiftName: selectedShiftSnapshot?.shiftName ?? selectedShiftTable?.description ?? "",
              shiftCode: selectedShiftSnapshot?.shiftCode ?? selectedShiftTable?.code ?? null,
              shiftSchedule: parsed.shiftSchedule ?? null,
              effectiveFrom: parsed.attendanceDate,
              effectiveTo: parsed.attendanceDate,
              checkInTime:
                selectedShiftSnapshot?.checkInTime ??
                selectedShiftTable?.regularStartTime ??
                "00:00",
              checkOutTime:
                selectedShiftSnapshot?.checkOutTime ??
                selectedShiftTable?.regularEndTime ??
                "00:00",
              breakMinutes: selectedShiftSnapshot?.breakMinutes ?? 0,
              paidBreakMinutes: selectedShiftSnapshot?.paidBreakMinutes ?? 0,
              graceMinutes: parsed.graceMinutes,
              restDay: null,
              hoursPerDay: (selectedShiftSnapshot?.hoursPerDay ?? 0).toFixed(2),
              isFlexible: parsed.isFlexible,
            };

      const staleStartDate =
        existingAssignment?.effectiveFrom ?? parsed.attendanceDate;
      const staleEndDate =
        existingAssignment?.effectiveTo ?? (existingAssignment ? null : parsed.attendanceDate);

      await markAffectedShiftRunsStale({
        tx,
        employeeId,
        startDate: staleStartDate,
        endDate: staleEndDate,
        actorUserId: actor.userId,
      });

      const replacement = await replaceAssignmentForOneDay({
        tx,
        existingAssignment,
        values: scheduleValues,
        attendanceDate: parsed.attendanceDate,
      });
      changedAssignmentIds.push(replacement.assignmentId);
      replacedAssignmentIds.push(...replacement.replacedAssignmentIds);

      const snapshotById = await loadAssignmentSnapshotsById(
        tx,
        [
          replacement.assignmentId,
          replacement.retainedAssignmentId,
          replacement.afterFragmentAssignmentId,
        ].filter((id): id is number => typeof id === "number")
      );
      const appliedAssignmentSnapshot = snapshotById.get(replacement.assignmentId);
      if (!appliedAssignmentSnapshot) {
        throw new Error("Unable to record schedule override revert metadata.");
      }

      const [revertItem] = await tx
        .insert(branchCalendarScheduleOverrideItems)
        .values({
          batchId: batch.id,
          employeeId,
          attendanceDate: parsed.attendanceDate,
          mutationType: replacement.mutationType,
          originalAssignmentId: existingAssignment?.id ?? null,
          appliedAssignmentId: replacement.assignmentId,
          retainedAssignmentId: replacement.retainedAssignmentId,
          afterFragmentAssignmentId: replacement.afterFragmentAssignmentId,
          staleStartDate,
          staleEndDate,
          previousAssignmentSnapshot,
          appliedAssignmentSnapshot,
          retainedAssignmentSnapshot: replacement.retainedAssignmentId
            ? snapshotById.get(replacement.retainedAssignmentId) ?? null
            : null,
          afterFragmentAssignmentSnapshot: replacement.afterFragmentAssignmentId
            ? snapshotById.get(replacement.afterFragmentAssignmentId) ?? null
            : null,
        })
        .returning({ id: branchCalendarScheduleOverrideItems.id });
      revertItemIds.push(revertItem.id);

      const latestImportedDate = await getLatestImportedAttendanceDate(tx, employeeId);
      const rebuildRange = getRebuildRange({
        staleRange: {
          startDate: staleStartDate,
          endDate: staleEndDate,
        },
        latestImportedDate,
      });

      if (rebuildRange) {
        rebuiltSummaryCount += await rebuildEmployeeAttendanceSummaries({
          tx,
          employeeId,
          startDate: rebuildRange.startDate,
          endDate: rebuildRange.endDate,
        });
      }
    }

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "branch_calendar_schedule_override",
      entityId: `${parsed.attendanceDate}:${employeeIds.length}`,
      action: "branch_calendar_schedule_override.saved",
      database: tx,
      details: {
        batchId: batch.id,
        attendanceDate: parsed.attendanceDate,
        employeeIds,
        mode: parsed.mode,
        shiftTableId: parsed.shiftTableId ?? null,
        shiftSchedule: parsed.shiftSchedule ?? null,
        graceMinutes: parsed.graceMinutes,
        isFlexible: parsed.isFlexible,
        changedAssignmentIds,
        replacedAssignmentIds,
        revertItemIds,
        rebuiltSummaryCount,
      },
    });

    return {
      changedAssignmentIds,
      replacedAssignmentIds,
      revertItemIds,
      rebuiltSummaryCount,
    };
  });

  revalidatePath("/branchCalendar");
  revalidatePath("/shiftAssignments");
  revalidatePath("/payroll");

  return {
    message: `Schedule override saved for ${employeeIds.length} employee${
      employeeIds.length === 1 ? "" : "s"
    } on ${parsed.attendanceDate}.`,
    ...result,
  };
}

async function revertBranchCalendarScheduleOverrideItem(args: {
  tx: DbClient;
  itemId: string;
  actorUserId: string;
  auditSource: "single" | "day";
}) {
  const [row] = await args.tx
    .select({
      item: branchCalendarScheduleOverrideItems,
      batch: branchCalendarScheduleOverrideBatches,
    })
    .from(branchCalendarScheduleOverrideItems)
    .innerJoin(
      branchCalendarScheduleOverrideBatches,
      eq(
        branchCalendarScheduleOverrideItems.batchId,
        branchCalendarScheduleOverrideBatches.id
      )
    )
    .where(eq(branchCalendarScheduleOverrideItems.id, args.itemId))
    .limit(1);

  if (!row) {
    throw new Error("Schedule override revert record was not found.");
  }

  const item = row.item;
  if (item.revertedAt) {
    throw new Error("This schedule override has already been reverted.");
  }

  await lockShiftAssignmentContext(args.tx, item.employeeId);

  await markAffectedShiftRunsStale({
    tx: args.tx,
    employeeId: item.employeeId,
    startDate: item.attendanceDate,
    endDate: item.attendanceDate,
    actorUserId: args.actorUserId,
  });

  const currentOverlappingAssignments = await args.tx
    .select()
    .from(employeeShiftAssignments)
    .where(
      and(
        eq(employeeShiftAssignments.employeeId, item.employeeId),
        lte(employeeShiftAssignments.effectiveFrom, item.attendanceDate),
        or(
          isNull(employeeShiftAssignments.effectiveTo),
          gte(employeeShiftAssignments.effectiveTo, item.attendanceDate)
        )
      )
    )
    .orderBy(asc(employeeShiftAssignments.effectiveFrom), asc(employeeShiftAssignments.id));

  const clearedAssignmentIds: number[] = [];
  const trimmedAssignmentIds: number[] = [];
  const createdFragmentIds: number[] = [];

  for (const assignment of currentOverlappingAssignments) {
    const clearResult = await clearAssignmentCoverageForDate({
      tx: args.tx,
      assignment,
      attendanceDate: item.attendanceDate,
    });
    clearedAssignmentIds.push(...clearResult.deletedAssignmentIds);
    trimmedAssignmentIds.push(...clearResult.trimmedAssignmentIds);
    createdFragmentIds.push(...clearResult.createdFragmentIds);
  }

  const latestImportedDate = await getLatestImportedAttendanceDate(
    args.tx,
    item.employeeId
  );
  const rebuildRange = getRebuildRange({
    staleRange: {
      startDate: item.attendanceDate,
      endDate: item.attendanceDate,
    },
    latestImportedDate,
  });
  const rebuiltSummaryCount = rebuildRange
    ? await rebuildEmployeeAttendanceSummaries({
        tx: args.tx,
        employeeId: item.employeeId,
        startDate: rebuildRange.startDate,
        endDate: rebuildRange.endDate,
      })
    : 0;

  await args.tx
    .update(branchCalendarScheduleOverrideItems)
    .set({
      revertedAt: new Date(),
      revertedByUserId: args.actorUserId,
      updatedAt: new Date(),
    })
    .where(eq(branchCalendarScheduleOverrideItems.id, item.id));

  const [remainingUnrevertedItem] = await args.tx
    .select({ id: branchCalendarScheduleOverrideItems.id })
    .from(branchCalendarScheduleOverrideItems)
    .where(
      and(
        eq(branchCalendarScheduleOverrideItems.batchId, item.batchId),
        isNull(branchCalendarScheduleOverrideItems.revertedAt)
      )
    )
    .limit(1);

  if (!remainingUnrevertedItem) {
    await args.tx
      .update(branchCalendarScheduleOverrideBatches)
      .set({
        revertedAt: new Date(),
        revertedByUserId: args.actorUserId,
        updatedAt: new Date(),
      })
      .where(eq(branchCalendarScheduleOverrideBatches.id, item.batchId));
  }

  await recordAdminAuditEvent({
    actorUserId: args.actorUserId,
    entityType: "branch_calendar_schedule_override",
    entityId: item.id,
    action: "branch_calendar_schedule_override.reverted",
    database: args.tx,
    details: {
      batchId: item.batchId,
      attendanceDate: item.attendanceDate,
      employeeId: item.employeeId,
      mutationType: item.mutationType,
      appliedAssignmentId: item.appliedAssignmentId,
      clearedAssignmentIds,
      trimmedAssignmentIds,
      createdFragmentIds,
      rebuiltSummaryCount,
      revertSource: args.auditSource,
    },
  });

  return {
    itemId: item.id,
    batchId: item.batchId,
    attendanceDate: item.attendanceDate,
    employeeId: item.employeeId,
    mutationType: item.mutationType,
    appliedAssignmentId: item.appliedAssignmentId,
    clearedAssignmentIds,
    trimmedAssignmentIds,
    createdFragmentIds,
    rebuiltSummaryCount,
  };
}

function revalidateBranchCalendarScheduleOverridePaths() {
  revalidatePath("/branchCalendar");
  revalidatePath("/shiftAssignments");
  revalidatePath("/payroll");
}

export async function revertBranchCalendarScheduleOverrideAction(input: unknown) {
  const actor = await requireAdminActor();
  const parsed = revertBranchCalendarScheduleOverrideSchema.parse(input);

  const result = await db.transaction((tx) =>
    revertBranchCalendarScheduleOverrideItem({
      tx,
      itemId: parsed.itemId,
      actorUserId: actor.userId,
      auditSource: "single",
    })
  );

  revalidateBranchCalendarScheduleOverridePaths();

  return {
    message: `Schedule override removed for ${result.attendanceDate}. Weekly schedule will be used.`,
    ...result,
  };
}

export async function revertBranchCalendarScheduleOverridesAction(input: unknown) {
  const actor = await requireAdminActor();
  const parsed = revertBranchCalendarScheduleOverridesSchema.parse(input);
  const itemIds = [...new Set(parsed.itemIds)];

  const result = await db.transaction(async (tx) => {
    const revertedItems = [];

    for (const itemId of itemIds) {
      revertedItems.push(
        await revertBranchCalendarScheduleOverrideItem({
          tx,
          itemId,
          actorUserId: actor.userId,
          auditSource: "day",
        })
      );
    }

    const attendanceDates = [...new Set(revertedItems.map((item) => item.attendanceDate))];

    return {
      attendanceDates,
      revertedCount: revertedItems.length,
      rebuiltSummaryCount: revertedItems.reduce(
        (total, item) => total + item.rebuiltSummaryCount,
        0
      ),
      itemIds: revertedItems.map((item) => item.itemId),
      employeeIds: revertedItems.map((item) => item.employeeId),
    };
  });

  revalidateBranchCalendarScheduleOverridePaths();

  return {
    message: `Schedule overrides removed for ${result.revertedCount} employee${
      result.revertedCount === 1 ? "" : "s"
    } on ${result.attendanceDates.join(", ")}. Weekly schedules will be used.`,
    ...result,
  };
}

export async function saveBranchCalendarHolidayCheckDatesAction(input: unknown) {
  const actor = await requireAdminActor();
  const parsed = saveBranchCalendarHolidayCheckDatesSchema.parse(input);

  const existingHoliday = await db.query.holidayYearCalendar.findFirst({
    where: eq(holidayYearCalendar.id, parsed.id),
  });

  if (!existingHoliday) {
    throw new Error("Selected holiday no longer exists.");
  }

  await db
    .update(holidayYearCalendar)
    .set({
      checkDate1: parsed.checkDate1,
      checkDate2: parsed.checkDate2,
      requireCheckDate1: parsed.requireCheckDate1,
      requireCheckDate2: parsed.requireCheckDate2,
      updatedAt: new Date(),
    })
    .where(eq(holidayYearCalendar.id, parsed.id));

  const refreshResult = existingHoliday.holidayDate
    ? await refreshGeneratedDtrRowsForHolidayCalendarChange({
        actorUserId: actor.userId,
        startDate: existingHoliday.holidayDate,
        endDate: existingHoliday.holidayDate2 ?? existingHoliday.holidayDate,
      })
    : {
        affectedPayrollPeriodCount: 0,
        affectedEmployeeCount: 0,
        generatedAccountCodeRowCount: 0,
        staleRunCount: 0,
        refreshedEntryCount: 0,
      };

  await recordAdminAuditEvent({
    actorUserId: actor.userId,
    entityType: "holiday_year_calendar",
    entityId: parsed.id,
    action: "holiday.check_dates.updated",
    details: {
      name: existingHoliday.name,
      holidayDate: existingHoliday.holidayDate,
      holidayDate2: existingHoliday.holidayDate2,
      checkDate1: parsed.checkDate1,
      checkDate2: parsed.checkDate2,
      requireCheckDate1: parsed.requireCheckDate1,
      requireCheckDate2: parsed.requireCheckDate2,
      refreshResult,
    },
  });

  revalidatePath("/branchCalendar");
  revalidatePath("/constants/holidayCode/form");
  revalidatePath("/payroll");

  return {
    message: `${existingHoliday.name} check dates saved.`,
    ...refreshResult,
  };
}
