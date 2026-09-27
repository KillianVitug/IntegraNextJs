import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import {
  cancelManagerScheduleChangeRequest,
  getManagerPayrollPeriodScheduleGridData,
  getManagerWeeklyScheduleGridData,
  submitManagerScheduleChangeRequest,
  updateManagerScheduleChangeRequest,
} from "@/app/actions/managerAction";
import {
  deleteEmployeeWeeklyShiftPattern,
  saveEmployeeWeeklyShiftPattern,
} from "@/app/actions/shiftAssignmentAction";
import {
  getLatestImportedAttendanceDate,
  getRebuildRange,
  loadShiftTablesById,
  lockShiftAssignmentContext,
  markAffectedShiftRunsStale,
  rebuildEmployeeAttendanceSummaries,
} from "@/app/actions/shiftAssignmentHelpers";
import { db, type DbClient } from "@/db";
import {
  employeeShiftAssignments,
  employeeWeeklyShiftPatterns,
} from "@/db/schema";
import { recordAdminAuditEvent } from "@/lib/admin";
import { requireManager } from "@/lib/auth/server";
import { buildRequestHostUrl } from "@/lib/http/redirect";
import { getWeeklyPatternIdsToPrune } from "@/lib/payroll/weeklyPatternPruning";
import { buildShiftAssignmentSnapshotFromTable } from "@/lib/shifts";

const WEEKDAY_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const MANAGER_WEEKLY_SCHEDULE_EFFECTIVE_FROM = "1900-01-01";
type WeekdayName = (typeof WEEKDAY_ORDER)[number];
type WeeklyScheduleGridRow = Awaited<
  ReturnType<typeof getManagerWeeklyScheduleGridData>
>[number];
type PayrollPeriodScheduleGrid = Awaited<
  ReturnType<typeof getManagerPayrollPeriodScheduleGridData>
>;
type PayrollPeriodScheduleGridRow = PayrollPeriodScheduleGrid["rows"][number];
type PayrollPeriodScheduleGridCell =
  PayrollPeriodScheduleGridRow["cells"][number];
type ShiftAssignmentRow = typeof employeeShiftAssignments.$inferSelect;
type ShiftAssignmentInsert = typeof employeeShiftAssignments.$inferInsert;

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function maybeNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function addDateKeyDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function getDayName(value: string) {
  return new Intl.DateTimeFormat("en", { weekday: "long" }).format(
    new Date(`${value}T00:00:00`),
  ) as ShiftAssignmentRow["restDay"];
}

function cloneAssignmentForInsert(
  assignment: ShiftAssignmentRow,
  range: { effectiveFrom: string; effectiveTo: string | null },
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

function buildRestDayAssignmentValues(args: {
  employeeId: string;
  attendanceDate: string;
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
    graceMinutes: 0,
    restDay: getDayName(args.attendanceDate),
    hoursPerDay: "0.00",
    isFlexible: false,
  };
}

async function replaceAssignmentForOneDay(args: {
  tx: DbClient;
  existingAssignment: ShiftAssignmentRow | null;
  values: ShiftAssignmentInsert;
  attendanceDate: string;
}) {
  if (!args.existingAssignment) {
    await args.tx.insert(employeeShiftAssignments).values(args.values);
    return;
  }

  const { existingAssignment, tx } = args;
  const attendanceDate = args.attendanceDate;
  const startsOnDate = existingAssignment.effectiveFrom === attendanceDate;
  const endsOnDate = existingAssignment.effectiveTo === attendanceDate;

  if (startsOnDate && endsOnDate) {
    await tx
      .update(employeeShiftAssignments)
      .set({
        ...args.values,
        updatedAt: new Date(),
      })
      .where(eq(employeeShiftAssignments.id, existingAssignment.id));
    return;
  }

  const nextDate = addDateKeyDays(attendanceDate, 1);
  const previousDate = addDateKeyDays(attendanceDate, -1);

  if (startsOnDate) {
    await tx
      .update(employeeShiftAssignments)
      .set({
        effectiveFrom: nextDate,
        updatedAt: new Date(),
      })
      .where(eq(employeeShiftAssignments.id, existingAssignment.id));
  } else {
    await tx
      .update(employeeShiftAssignments)
      .set({
        effectiveTo: previousDate,
        updatedAt: new Date(),
      })
      .where(eq(employeeShiftAssignments.id, existingAssignment.id));

    if (!endsOnDate) {
      await tx.insert(employeeShiftAssignments).values(
        cloneAssignmentForInsert(existingAssignment, {
          effectiveFrom: nextDate,
          effectiveTo: existingAssignment.effectiveTo,
        }),
      );
    }
  }

  await tx.insert(employeeShiftAssignments).values(args.values);
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
    return;
  }

  if (startsOnDate) {
    await tx
      .update(employeeShiftAssignments)
      .set({
        effectiveFrom: nextDate,
        updatedAt: new Date(),
      })
      .where(eq(employeeShiftAssignments.id, assignment.id));
    return;
  }

  if (endsOnDate) {
    await tx
      .update(employeeShiftAssignments)
      .set({
        effectiveTo: previousDate,
        updatedAt: new Date(),
      })
      .where(eq(employeeShiftAssignments.id, assignment.id));
    return;
  }

  await tx
    .update(employeeShiftAssignments)
    .set({
      effectiveTo: previousDate,
      updatedAt: new Date(),
    })
    .where(eq(employeeShiftAssignments.id, assignment.id));

  await tx.insert(employeeShiftAssignments).values(
    cloneAssignmentForInsert(assignment, {
      effectiveFrom: nextDate,
      effectiveTo: assignment.effectiveTo,
    }),
  );
}

function redirectToManagerSchedules(
  request: NextRequest,
  args: {
    employeeId?: string;
    tab?: string;
    periodId?: string;
    status?: string;
    error?: unknown;
  },
) {
  const url = buildRequestHostUrl(request, "/managerSchedules");
  if (args.employeeId) url.searchParams.set("employeeId", args.employeeId);
  if (args.tab) url.searchParams.set("tab", args.tab);
  if (args.periodId) url.searchParams.set("periodId", args.periodId);
  if (args.status) url.searchParams.set("status", args.status);
  if (args.error) {
    url.searchParams.set(
      "error",
      args.error instanceof Error ? args.error.message : "Unable to save schedule.",
    );
  }

  return NextResponse.redirect(url, 303);
}

async function pruneManagerWeeklyPatternsForEmployee(args: {
  employeeId: string;
  keepPatternId: number | null | undefined;
}) {
  const auth = await requireManager();

  return db.transaction(async (tx) => {
    await lockShiftAssignmentContext(tx, args.employeeId);

    const patterns = await tx
      .select({
        id: employeeWeeklyShiftPatterns.id,
        employeeId: employeeWeeklyShiftPatterns.employeeId,
        effectiveFrom: employeeWeeklyShiftPatterns.effectiveFrom,
        effectiveTo: employeeWeeklyShiftPatterns.effectiveTo,
      })
      .from(employeeWeeklyShiftPatterns)
      .where(eq(employeeWeeklyShiftPatterns.employeeId, args.employeeId));
    const pruneIds = getWeeklyPatternIdsToPrune(patterns, args.keepPatternId);

    if (pruneIds.length === 0) {
      return { prunedCount: 0 };
    }

    await tx
      .delete(employeeWeeklyShiftPatterns)
      .where(inArray(employeeWeeklyShiftPatterns.id, pruneIds));

    await recordAdminAuditEvent({
      actorUserId: auth.accountId,
      entityType: "employee_weekly_shift_pattern",
      entityId: `${args.employeeId}:manager-prune`,
      action: "employee_weekly_shift_pattern.manager_pruned",
      database: tx,
      details: {
        employeeId: args.employeeId,
        keepPatternId: args.keepPatternId ?? null,
        prunedPatternIds: pruneIds,
      },
    });

    return { prunedCount: pruneIds.length };
  });
}

function parseEffectiveDates(formData: FormData) {
  return [
    ...new Set(
      formData
        .getAll("effectiveDates")
        .flatMap((value) =>
          typeof value === "string" ? value.split(/[\s,;]+/) : [],
        )
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function buildSchedulePayload(formData: FormData) {
  const effectiveDates = parseEffectiveDates(formData);
  const firstEffectiveDate = effectiveDates[0] ?? "";
  const lastEffectiveDate = effectiveDates[effectiveDates.length - 1] ?? "";

  return {
    employeeId: text(formData, "employeeId"),
    shiftTableId: Number(text(formData, "shiftTableId")),
    shiftSchedule: null,
    effectiveFrom: firstEffectiveDate,
    effectiveTo: lastEffectiveDate,
    effectiveDates,
    graceMinutes: 0,
    restDay: null,
    isFlexible: false,
  };
}

function getSelectedWeeklyGridDays(formData: FormData, employeeId: string) {
  return WEEKDAY_ORDER.map((weekday) => ({
    weekday,
    shiftTableId:
      maybeNumber(text(formData, `day-${employeeId}-${weekday}`)) ?? null,
  }));
}

function getPatternShiftTableId(
  pattern: WeeklyScheduleGridRow["weeklyPattern"],
  weekday: WeekdayName,
) {
  return (
    pattern?.days.find((day) => day.weekday === weekday)?.shiftTableId ?? null
  );
}

function hasWeeklyGridRowChanged(
  row: WeeklyScheduleGridRow,
  days: ReturnType<typeof getSelectedWeeklyGridDays>,
) {
  return days.some(
    (day) =>
      getPatternShiftTableId(row.weeklyPattern, day.weekday) !== day.shiftTableId,
  );
}

function getPeriodGridFieldName(employeeId: string, date: string) {
  return `period-day-${employeeId}-${date}`;
}

function getSelectedPeriodGridValue(
  formData: FormData,
  cell: PayrollPeriodScheduleGridCell,
  employeeId: string,
) {
  const rawValue = text(formData, getPeriodGridFieldName(employeeId, cell.date));
  const shiftTableId = maybeNumber(rawValue);

  return {
    value: shiftTableId ? String(shiftTableId) : "0",
    shiftTableId: shiftTableId ?? null,
  };
}

async function loadCoveringAssignmentForDate(args: {
  tx: DbClient;
  employeeId: string;
  attendanceDate: string;
  employeeLabel: string;
}) {
  const assignments = await args.tx
    .select()
    .from(employeeShiftAssignments)
    .where(
      and(
        eq(employeeShiftAssignments.employeeId, args.employeeId),
        lte(employeeShiftAssignments.effectiveFrom, args.attendanceDate),
        or(
          isNull(employeeShiftAssignments.effectiveTo),
          gte(employeeShiftAssignments.effectiveTo, args.attendanceDate),
        ),
      ),
    )
    .orderBy(
      asc(employeeShiftAssignments.effectiveFrom),
      asc(employeeShiftAssignments.id),
    );

  if (assignments.length > 1) {
    throw new Error(
      `${args.employeeLabel} has multiple shift overrides covering ${args.attendanceDate}. Resolve the overlap first.`,
    );
  }

  return assignments[0] ?? null;
}

async function markScheduleChangeStale(args: {
  tx: DbClient;
  actorUserId: string;
  employeeId: string;
  staleStartDate: string;
  staleEndDate: string | null;
}) {
  await markAffectedShiftRunsStale({
    tx: args.tx,
    employeeId: args.employeeId,
    startDate: args.staleStartDate,
    endDate: args.staleEndDate,
    actorUserId: args.actorUserId,
  });
}

async function rebuildScheduleChangeSummaries(args: {
  tx: DbClient;
  employeeId: string;
  staleStartDate: string;
  staleEndDate: string | null;
}) {
  const latestImportedDate = await getLatestImportedAttendanceDate(
    args.tx,
    args.employeeId,
  );
  const rebuildRange = getRebuildRange({
    staleRange: {
      startDate: args.staleStartDate,
      endDate: args.staleEndDate,
    },
    latestImportedDate,
  });

  if (!rebuildRange) return 0;

  return rebuildEmployeeAttendanceSummaries({
    tx: args.tx,
    employeeId: args.employeeId,
    startDate: rebuildRange.startDate,
    endDate: rebuildRange.endDate,
  });
}

export async function saveWeeklyScheduleFromRequest(request: NextRequest) {
  const formData = await request.formData();
  const employeeId = text(formData, "employeeId");

  try {
    const result = await saveEmployeeWeeklyShiftPattern({
      id: maybeNumber(text(formData, "id")),
      employeeId,
      effectiveFrom: MANAGER_WEEKLY_SCHEDULE_EFFECTIVE_FROM,
      effectiveTo: null,
      days: WEEKDAY_ORDER.map((weekday) => ({
        weekday,
        shiftTableId: maybeNumber(text(formData, `day-${weekday}`)) ?? null,
      })),
    });
    await pruneManagerWeeklyPatternsForEmployee({
      employeeId,
      keepPatternId: result.patternId,
    });
  } catch (error) {
    return redirectToManagerSchedules(request, { employeeId, error });
  }

  return redirectToManagerSchedules(request, { employeeId, status: "weekly-saved" });
}

export async function saveBulkWeeklyScheduleFromRequest(request: NextRequest) {
  const formData = await request.formData();

  try {
    const submittedEmployeeIds = new Set(
      formData
        .getAll("employeeId")
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    );
    const rows = await getManagerWeeklyScheduleGridData();

    for (const row of rows) {
      if (!submittedEmployeeIds.has(row.id)) continue;

      const days = getSelectedWeeklyGridDays(formData, row.id);
      let keepPatternId = row.weeklyPattern?.id ?? null;

      if (hasWeeklyGridRowChanged(row, days)) {
        const result = await saveEmployeeWeeklyShiftPattern({
          id: row.weeklyPattern?.id,
          employeeId: row.id,
          effectiveFrom: MANAGER_WEEKLY_SCHEDULE_EFFECTIVE_FROM,
          effectiveTo: null,
          days,
        });
        keepPatternId = result.patternId;
      }

      if (keepPatternId != null) {
        await pruneManagerWeeklyPatternsForEmployee({
          employeeId: row.id,
          keepPatternId,
        });
      }
    }
  } catch (error) {
    return redirectToManagerSchedules(request, {
      tab: "weeklySchedule",
      error,
    });
  }

  return redirectToManagerSchedules(request, {
    tab: "weeklySchedule",
    status: "weekly-grid-saved",
  });
}

export async function savePayrollPeriodScheduleFromRequest(request: NextRequest) {
  const formData = await request.formData();
  const periodId = text(formData, "periodId");

  try {
    if (!periodId) {
      throw new Error("Select a payroll period before saving.");
    }

    const auth = await requireManager();
    const gridData = await getManagerPayrollPeriodScheduleGridData({ periodId });

    if (gridData.selectedPeriodId !== periodId) {
      throw new Error("Selected payroll period was not found.");
    }

    const changes: Array<{
      row: PayrollPeriodScheduleGridRow;
      cell: PayrollPeriodScheduleGridCell;
      selectedValue: string;
      selectedShiftTableId: number | null;
    }> = [];

    for (const row of gridData.rows) {
      for (const cell of row.cells) {
        const selected = getSelectedPeriodGridValue(formData, cell, row.id);
        if (selected.value === cell.currentValue) continue;

        changes.push({
          row,
          cell,
          selectedValue: selected.value,
          selectedShiftTableId: selected.shiftTableId,
        });
      }
    }

    const changedShiftTableIds = changes
      .map((change) => change.selectedShiftTableId)
      .filter((shiftTableId): shiftTableId is number => shiftTableId != null);

    const result = await db.transaction(async (tx) => {
      const shiftTablesById = await loadShiftTablesById(tx, changedShiftTableIds);
      let rebuiltSummaryCount = 0;
      let createdOrUpdatedCount = 0;
      let removedOverrideCount = 0;

      for (const change of changes) {
        await lockShiftAssignmentContext(tx, change.row.id);

        const employeeLabel = `${change.row.lastName}, ${change.row.firstName}`;
        const existingAssignment = await loadCoveringAssignmentForDate({
          tx,
          employeeId: change.row.id,
          attendanceDate: change.cell.date,
          employeeLabel,
        });
        const staleStartDate = existingAssignment?.effectiveFrom ?? change.cell.date;
        const staleEndDate =
          existingAssignment?.effectiveTo ??
          (existingAssignment ? null : change.cell.date);

        await markScheduleChangeStale({
          tx,
          actorUserId: auth.accountId,
          employeeId: change.row.id,
          staleStartDate,
          staleEndDate,
        });

        if (change.selectedValue === change.cell.baseValue) {
          if (existingAssignment) {
            await clearAssignmentCoverageForDate({
              tx,
              assignment: existingAssignment,
              attendanceDate: change.cell.date,
            });
            removedOverrideCount += 1;
          }
          rebuiltSummaryCount += await rebuildScheduleChangeSummaries({
            tx,
            employeeId: change.row.id,
            staleStartDate,
            staleEndDate,
          });
          continue;
        }

        const values: ShiftAssignmentInsert = change.selectedShiftTableId
          ? (() => {
              const selectedShiftTableId = change.selectedShiftTableId;
              const shiftTable = shiftTablesById.get(selectedShiftTableId);
              if (!shiftTable) {
                throw new Error("Selected shift table was not found.");
              }

              const snapshot = buildShiftAssignmentSnapshotFromTable(shiftTable);
              return {
                employeeId: change.row.id,
                shiftTableId: selectedShiftTableId,
                shiftName: snapshot.shiftName ?? shiftTable.description,
                shiftCode: snapshot.shiftCode ?? shiftTable.code,
                shiftSchedule: null,
                effectiveFrom: change.cell.date,
                effectiveTo: change.cell.date,
                checkInTime: snapshot.checkInTime ?? shiftTable.regularStartTime,
                checkOutTime: snapshot.checkOutTime ?? shiftTable.regularEndTime,
                breakMinutes: snapshot.breakMinutes,
                paidBreakMinutes: snapshot.paidBreakMinutes,
                graceMinutes: 0,
                restDay: null,
                hoursPerDay: snapshot.hoursPerDay.toFixed(2),
                isFlexible: false,
              };
            })()
          : buildRestDayAssignmentValues({
              employeeId: change.row.id,
              attendanceDate: change.cell.date,
            });

        await replaceAssignmentForOneDay({
          tx,
          existingAssignment,
          values,
          attendanceDate: change.cell.date,
        });
        createdOrUpdatedCount += 1;
        rebuiltSummaryCount += await rebuildScheduleChangeSummaries({
          tx,
          employeeId: change.row.id,
          staleStartDate,
          staleEndDate,
        });
      }

      if (changes.length > 0) {
        await recordAdminAuditEvent({
          actorUserId: auth.accountId,
          entityType: "manager_payroll_period_schedule_grid",
          entityId: periodId,
          action: "manager_payroll_period_schedule_grid.saved",
          database: tx,
          details: {
            periodId,
            changedCellCount: changes.length,
            createdOrUpdatedCount,
            removedOverrideCount,
            rebuiltSummaryCount,
            cells: changes.map((change) => ({
              employeeId: change.row.id,
              date: change.cell.date,
              baseValue: change.cell.baseValue,
              previousValue: change.cell.currentValue,
              nextValue: change.selectedValue,
            })),
          },
        });
      }

      return {
        changedCellCount: changes.length,
        rebuiltSummaryCount,
      };
    });

    revalidatePath("/managerSchedules");
    revalidatePath("/payroll");

    return redirectToManagerSchedules(request, {
      tab: "weeklySchedule",
      periodId,
      status:
        result.changedCellCount > 0
          ? "period-grid-saved"
          : "period-grid-unchanged",
    });
  } catch (error) {
    return redirectToManagerSchedules(request, {
      tab: "weeklySchedule",
      periodId,
      error,
    });
  }
}

export async function deleteWeeklyScheduleFromRequest(request: NextRequest) {
  const formData = await request.formData();
  const employeeId = text(formData, "employeeId");

  try {
    await deleteEmployeeWeeklyShiftPattern({ id: text(formData, "id") });
  } catch (error) {
    return redirectToManagerSchedules(request, { employeeId, error });
  }

  return redirectToManagerSchedules(request, { employeeId, status: "weekly-deleted" });
}

export async function saveScheduleRequestFromRequest(request: NextRequest) {
  const formData = await request.formData();
  const employeeId = text(formData, "employeeId");
  const requestId = text(formData, "requestId");

  try {
    if (requestId) {
      await updateManagerScheduleChangeRequest({
        requestId,
        payload: buildSchedulePayload(formData),
        reason: text(formData, "reason"),
      });
    } else {
      await submitManagerScheduleChangeRequest({
        action: "Create",
        payload: buildSchedulePayload(formData),
        reason: text(formData, "reason"),
      });
    }
  } catch (error) {
    return redirectToManagerSchedules(request, { employeeId, error });
  }

  return redirectToManagerSchedules(request, {
    employeeId,
    status: requestId ? "request-updated" : "request-created",
  });
}

export async function cancelScheduleRequestFromRequest(request: NextRequest) {
  const formData = await request.formData();
  const employeeId = text(formData, "employeeId");

  try {
    await cancelManagerScheduleChangeRequest({
      requestId: text(formData, "requestId"),
    });
  } catch (error) {
    return redirectToManagerSchedules(request, { employeeId, error });
  }

  return redirectToManagerSchedules(request, {
    employeeId,
    status: "request-cancelled",
  });
}
