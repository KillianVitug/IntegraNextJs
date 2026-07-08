import { addDays, format } from "date-fns";
import type { DbClient } from "@/db";
import {
  attendanceDailySummaries,
  attendanceRawLogs,
  employeeShiftAssignments,
  employeeWeeklyShiftPatterns,
  employeeWeeklyShiftPatternDays,
  employees,
  employeesLeaveRecords,
  payrollPeriods,
  payrollRunEmployees,
  payrollRuns,
  shiftTableBreaks,
  shiftTables,
} from "@/db/schema";
import { recordPayrollRunEvent } from "@/lib/admin";
import { buildAttendanceSummaryComputations } from "@/lib/payroll/attendanceSync";
import { buildLeaveTypeMapByCode, resolveLeavePayStatus } from "@/lib/payroll/leave";
import { buildShiftAssignmentSnapshotFromTable } from "@/lib/shifts";
import {
  type UpsertEmployeeShiftAssignmentInput,
} from "@/zod-schemas/employeeShiftAssignment";
import {
  type UpsertEmployeeWeeklyShiftPatternInput,
} from "@/zod-schemas/employeeWeeklyShiftPattern";
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";

export type EffectiveDateRangeRecord = {
  effectiveFrom: string;
  effectiveTo: string | null;
};

export function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export function collectShiftTableIds(args: {
  shiftAssignments: Array<{ shiftTableId: number | null }>;
  weeklyPatterns: Array<{
    days: Array<{ shiftTableId: number | null }>;
  }>;
}) {
  return [...new Set(
    [
      ...args.shiftAssignments.map((assignment) => assignment.shiftTableId),
      ...args.weeklyPatterns.flatMap((pattern) =>
        pattern.days.map((day) => day.shiftTableId)
      ),
    ].filter((shiftTableId): shiftTableId is number => typeof shiftTableId === "number" && shiftTableId > 0)
  )];
}

export function buildShiftTableBreakLookup(
  breakRows: typeof shiftTableBreaks.$inferSelect[]
) {
  const breaksByShiftTableId = new Map<number, typeof shiftTableBreaks.$inferSelect[]>();

  for (const breakRow of breakRows) {
    const current = breaksByShiftTableId.get(breakRow.shiftTableId) ?? [];
    current.push(breakRow);
    breaksByShiftTableId.set(breakRow.shiftTableId, current);
  }

  return breaksByShiftTableId;
}

export function rangesOverlap(
  firstStart: string,
  firstEnd: string | null,
  secondStart: string,
  secondEnd: string | null
) {
  const firstEndValue = firstEnd ?? "9999-12-31";
  const secondEndValue = secondEnd ?? "9999-12-31";

  return firstStart <= secondEndValue && secondStart <= firstEndValue;
}

export function normalizeEffectiveTo(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

export function getAffectedScheduleRange(args: {
  existingRecord?: EffectiveDateRangeRecord | null;
  nextAssignment?: {
    effectiveFrom: string;
    effectiveTo: string | null;
  } | null;
}) {
  const starts = [args.existingRecord?.effectiveFrom, args.nextAssignment?.effectiveFrom]
    .filter((value): value is string => Boolean(value))
    .sort();
  const hasOpenEndedRange =
    args.existingRecord?.effectiveTo == null || args.nextAssignment?.effectiveTo == null;
  const ends = [args.existingRecord?.effectiveTo, args.nextAssignment?.effectiveTo]
    .filter((value): value is string => Boolean(value))
    .sort();

  return {
    startDate: starts[0] ?? null,
    endDate: hasOpenEndedRange ? null : ends[ends.length - 1] ?? null,
  };
}

export function getRebuildRange(args: {
  staleRange: { startDate: string | null; endDate: string | null };
  latestImportedDate: string | null;
}) {
  if (!args.staleRange.startDate || !args.latestImportedDate) {
    return null;
  }

  const endDate =
    args.staleRange.endDate && args.staleRange.endDate < args.latestImportedDate
      ? args.staleRange.endDate
      : args.latestImportedDate;

  if (endDate < args.staleRange.startDate) {
    return null;
  }

  return {
    startDate: args.staleRange.startDate,
    endDate,
  };
}

export async function lockShiftAssignmentContext(tx: DbClient, employeeId: string) {
  await tx.execute(sql`select id from employees where id = ${employeeId} for update`);
  await tx.execute(
    sql`select id from employee_shift_assignments where employee_id = ${employeeId} for update`
  );
  await tx.execute(
    sql`select id from employee_weekly_shift_patterns where employee_id = ${employeeId} for update`
  );
}

export async function ensureNoShiftOverlap(tx: DbClient, input: UpsertEmployeeShiftAssignmentInput) {
  const existing = input.id
    ? await tx
        .select()
        .from(employeeShiftAssignments)
        .where(
          and(
            eq(employeeShiftAssignments.employeeId, input.employeeId),
            ne(employeeShiftAssignments.id, input.id)
          )
        )
    : await tx
        .select()
        .from(employeeShiftAssignments)
        .where(eq(employeeShiftAssignments.employeeId, input.employeeId));

  const overlapping = existing.find((row: typeof employeeShiftAssignments.$inferSelect) =>
    rangesOverlap(
      input.effectiveFrom,
      normalizeEffectiveTo(input.effectiveTo),
      row.effectiveFrom,
      row.effectiveTo
    )
  );

  if (overlapping) {
    throw new Error(
      `Shift assignment overlaps with ${overlapping.shiftName} (${overlapping.effectiveFrom} to ${overlapping.effectiveTo ?? "open"}).`
    );
  }
}

export async function ensureNoWeeklyPatternOverlap(
  tx: DbClient,
  input: UpsertEmployeeWeeklyShiftPatternInput
) {
  const existing = input.id
    ? await tx
        .select()
        .from(employeeWeeklyShiftPatterns)
        .where(
          and(
            eq(employeeWeeklyShiftPatterns.employeeId, input.employeeId),
            ne(employeeWeeklyShiftPatterns.id, input.id)
          )
        )
    : await tx
        .select()
        .from(employeeWeeklyShiftPatterns)
        .where(eq(employeeWeeklyShiftPatterns.employeeId, input.employeeId));

  const overlapping = existing.find(
    (row: typeof employeeWeeklyShiftPatterns.$inferSelect) =>
      rangesOverlap(
        input.effectiveFrom,
        normalizeEffectiveTo(input.effectiveTo),
        row.effectiveFrom,
        row.effectiveTo
      )
  );

  if (overlapping) {
    throw new Error(
      `Weekly schedule overlaps with ${overlapping.effectiveFrom} to ${overlapping.effectiveTo ?? "open"}.`
    );
  }
}

export async function loadShiftTableForAssignment(tx: DbClient, shiftTableId: number) {
  const [shiftTable] = await tx
    .select()
    .from(shiftTables)
    .where(eq(shiftTables.id, shiftTableId))
    .limit(1);

  if (!shiftTable) {
    throw new Error("Selected shift table was not found.");
  }

  const breaks = await tx
    .select()
    .from(shiftTableBreaks)
    .where(eq(shiftTableBreaks.shiftTableId, shiftTableId))
    .orderBy(asc(shiftTableBreaks.sortOrder));

  return {
    ...shiftTable,
    breaks,
  };
}

export async function loadShiftTablesById(tx: DbClient, shiftTableIds: number[]) {
  const uniqueShiftTableIds = [...new Set(shiftTableIds)].filter((value) => value > 0);
  const entries = await Promise.all(
    uniqueShiftTableIds.map(async (shiftTableId) => [
      shiftTableId,
      await loadShiftTableForAssignment(tx, shiftTableId),
    ] as const)
  );

  return new Map(entries);
}

export function buildWeeklyPatternDayValues(args: {
  patternId: number;
  days: UpsertEmployeeWeeklyShiftPatternInput["days"];
  shiftTablesById: Map<number, Awaited<ReturnType<typeof loadShiftTableForAssignment>>>;
}) {
  return args.days.map((day) => {
    if (!day.shiftTableId) {
      return {
        patternId: args.patternId,
        weekday: day.weekday,
        shiftTableId: null,
        shiftName: null,
        shiftCode: null,
        checkInTime: null,
        checkOutTime: null,
        breakMinutes: 0,
        paidBreakMinutes: 0,
        hoursPerDay: "0.00",
      } satisfies typeof employeeWeeklyShiftPatternDays.$inferInsert;
    }

    const shiftTable = args.shiftTablesById.get(day.shiftTableId);
    if (!shiftTable) {
      throw new Error("Selected shift table was not found.");
    }

    const snapshot = buildShiftAssignmentSnapshotFromTable(shiftTable);

    return {
      patternId: args.patternId,
      weekday: day.weekday,
      shiftTableId: day.shiftTableId,
      shiftName: snapshot.shiftName,
      shiftCode: snapshot.shiftCode,
      checkInTime: snapshot.checkInTime ?? shiftTable.regularStartTime,
      checkOutTime: snapshot.checkOutTime ?? shiftTable.regularEndTime,
      breakMinutes: snapshot.breakMinutes,
      paidBreakMinutes: snapshot.paidBreakMinutes,
      hoursPerDay: snapshot.hoursPerDay.toFixed(2),
    } satisfies typeof employeeWeeklyShiftPatternDays.$inferInsert;
  });
}

export async function getLatestImportedAttendanceDate(tx: DbClient, employeeId: string) {
  const [latestRawLog] = await tx
    .select({
      date: attendanceRawLogs.logDate,
    })
    .from(attendanceRawLogs)
    .where(eq(attendanceRawLogs.employeeId, employeeId))
    .orderBy(desc(attendanceRawLogs.logDate))
    .limit(1);
  const [latestSummary] = await tx
    .select({
      date: attendanceDailySummaries.attendanceDate,
    })
    .from(attendanceDailySummaries)
    .where(eq(attendanceDailySummaries.employeeId, employeeId))
    .orderBy(desc(attendanceDailySummaries.attendanceDate))
    .limit(1);

  const latestDates = [latestRawLog?.date, latestSummary?.date]
    .filter((value): value is string => Boolean(value))
    .sort();

  return latestDates[latestDates.length - 1] ?? null;
}

export async function rebuildEmployeeAttendanceSummaries(args: {
  tx: DbClient;
  employeeId: string;
  startDate: string;
  endDate: string;
}) {
  const employee = await args.tx.query.employees.findFirst({
    where: eq(employees.id, args.employeeId),
    with: {
      timekeeping: true,
    },
  });

  if (!employee) return 0;

  const logQueryEndDate = format(
    addDays(new Date(`${args.endDate}T00:00:00`), 1),
    "yyyy-MM-dd"
  );
  const assignmentQueryStartDate = format(
    addDays(new Date(`${args.startDate}T00:00:00`), -1),
    "yyyy-MM-dd"
  );
  const rawLogs = await args.tx
    .select({
      employeeNo: attendanceRawLogs.employeeNo,
      employeeId: attendanceRawLogs.employeeId,
      batchId: attendanceRawLogs.batchId,
      loggedAt: attendanceRawLogs.loggedAt,
      logDate: attendanceRawLogs.logDate,
      logTime: attendanceRawLogs.logTime,
      direction: attendanceRawLogs.direction,
      sourceLine: attendanceRawLogs.sourceLine,
      rawText: attendanceRawLogs.rawText,
      deviceId: attendanceRawLogs.deviceId,
      siteCode: attendanceRawLogs.siteCode,
    })
    .from(attendanceRawLogs)
    .where(
      and(
        eq(attendanceRawLogs.employeeId, args.employeeId),
        gte(attendanceRawLogs.logDate, args.startDate),
        lte(attendanceRawLogs.logDate, logQueryEndDate)
      )
    )
    .orderBy(asc(attendanceRawLogs.loggedAt), asc(attendanceRawLogs.id));
  const approvedLeaves = await args.tx.query.employeesLeaveRecords.findMany({
    where: and(
      eq(employeesLeaveRecords.employeeId, args.employeeId),
      eq(employeesLeaveRecords.leaveStatus, "Approved")
    ),
    with: {
      leaveTypeLookup: true,
    },
  });
  const leaveTypesByCode = await buildLeaveTypeMapByCode(
    approvedLeaves
      .filter((leave: typeof approvedLeaves[number]) => leave.leaveTypeLookup == null)
      .map((leave: typeof approvedLeaves[number]) => leave.leaveType),
    args.tx
  );
  const shiftAssignments = await args.tx
    .select()
    .from(employeeShiftAssignments)
    .where(
      and(
        eq(employeeShiftAssignments.employeeId, args.employeeId),
        lte(employeeShiftAssignments.effectiveFrom, args.endDate),
        sql`(${employeeShiftAssignments.effectiveTo} is null or ${employeeShiftAssignments.effectiveTo} >= ${assignmentQueryStartDate})`
      )
    )
    .orderBy(desc(employeeShiftAssignments.effectiveFrom), desc(employeeShiftAssignments.id));
  const weeklyPatterns = (
    await args.tx.query.employeeWeeklyShiftPatterns.findMany({
      where: and(
        eq(employeeWeeklyShiftPatterns.employeeId, args.employeeId),
        lte(employeeWeeklyShiftPatterns.effectiveFrom, args.endDate)
      ),
      with: {
        days: true,
      },
    })
  )
    .filter(
      (
        pattern: typeof employeeWeeklyShiftPatterns.$inferSelect & {
          days: typeof employeeWeeklyShiftPatternDays.$inferSelect[];
        }
      ) => !pattern.effectiveTo || pattern.effectiveTo >= assignmentQueryStartDate
    )
    .sort((
      left: typeof employeeWeeklyShiftPatterns.$inferSelect & {
        days: typeof employeeWeeklyShiftPatternDays.$inferSelect[];
      },
      right: typeof employeeWeeklyShiftPatterns.$inferSelect & {
        days: typeof employeeWeeklyShiftPatternDays.$inferSelect[];
      }
    ) => {
      const fromComparison = right.effectiveFrom.localeCompare(left.effectiveFrom);
      if (fromComparison !== 0) return fromComparison;
      return right.id - left.id;
    });
  const shiftTableIds = collectShiftTableIds({
    shiftAssignments,
    weeklyPatterns,
  });
  const shiftTableBreakRows =
    shiftTableIds.length === 0
      ? []
      : await args.tx
          .select()
          .from(shiftTableBreaks)
          .where(inArray(shiftTableBreaks.shiftTableId, shiftTableIds))
          .orderBy(asc(shiftTableBreaks.shiftTableId), asc(shiftTableBreaks.sortOrder));
  const computations = buildAttendanceSummaryComputations({
    employees: [
      {
        id: employee.id,
        employeeNo: employee.employeeNo,
        timekeeping: employee.timekeeping ?? null,
      },
    ],
    logs: rawLogs.map((log: typeof rawLogs[number]) => ({
      employeeNo: log.employeeNo,
      employeeId: log.employeeId ?? null,
      batchId: log.batchId,
      loggedAt: log.loggedAt,
      logDate: log.logDate,
      logTime: log.logTime,
      direction: log.direction,
      sourceLine: log.sourceLine ?? 0,
      rawText: log.rawText ?? "",
      deviceId: log.deviceId ?? null,
      siteCode: log.siteCode ?? null,
    })),
    approvedLeaves: approvedLeaves.map((leave: typeof approvedLeaves[number]) => ({
      employeeId: leave.employeeId,
      leaveStartDate: leave.leaveStartDate,
      leaveEndDate: leave.leaveEndDate,
      dateFiled: leave.dateFiled,
      isPaid: resolveLeavePayStatus(leave, leaveTypesByCode).isPaid,
    })),
    shiftAssignments,
    weeklyPatterns,
    shiftTableBreaksByShiftTableId: buildShiftTableBreakLookup(shiftTableBreakRows),
    allowedAttendanceDateRange: {
      startDate: args.startDate,
      endDate: args.endDate,
    },
  });

  await args.tx
    .delete(attendanceDailySummaries)
    .where(
      and(
        eq(attendanceDailySummaries.employeeId, args.employeeId),
        gte(attendanceDailySummaries.attendanceDate, args.startDate),
        lte(attendanceDailySummaries.attendanceDate, args.endDate)
      )
    );

  for (const rows of chunk(computations, 200)) {
    if (rows.length === 0) continue;
    await args.tx.insert(attendanceDailySummaries).values(rows);
  }

  return computations.length;
}

export async function markAffectedShiftRunsStale(args: {
  tx: DbClient;
  employeeId: string;
  startDate: string;
  endDate: string | null;
  actorUserId: string;
}) {
  const periodFilters = [gte(payrollPeriods.endDate, args.startDate)];
  if (args.endDate) {
    periodFilters.push(lte(payrollPeriods.startDate, args.endDate));
  }

  const affectedRuns = await args.tx
    .select({
      id: payrollRuns.id,
      status: payrollRuns.status,
      periodCode: payrollPeriods.code,
    })
    .from(payrollRuns)
    .innerJoin(payrollPeriods, eq(payrollRuns.payrollPeriodId, payrollPeriods.id))
    .innerJoin(payrollRunEmployees, eq(payrollRunEmployees.payrollRunId, payrollRuns.id))
    .where(
      and(
        eq(payrollRunEmployees.employeeId, args.employeeId),
        ...periodFilters
      )
    )
    .orderBy(desc(payrollRuns.createdAt));

  const blockingRun = affectedRuns.find(
    (run: { status: string }) => run.status === "Approved" || run.status === "Posted"
  );

  if (blockingRun) {
    throw new Error(
      `Schedule changes are blocked because payroll period ${blockingRun.periodCode} already has a ${blockingRun.status} run.`
    );
  }

  const staleRunIds = affectedRuns
    .filter((run: { status: string }) => run.status === "Draft" || run.status === "Reviewed")
    .map((run: { id: string }) => run.id);

  if (staleRunIds.length === 0) return;

  await args.tx
    .update(payrollRuns)
    .set({
      status: "Stale",
      reviewedAt: null,
      reviewedByUserId: null,
      approvedAt: null,
      approvedByUserId: null,
      updatedAt: new Date(),
    })
    .where(inArray(payrollRuns.id, staleRunIds));

  for (const runId of staleRunIds) {
    await recordPayrollRunEvent({
      payrollRunId: runId,
      actorUserId: args.actorUserId,
      eventType: "MarkedStale",
      toStatus: "Stale",
      database: args.tx,
      notes: "Marked stale because employee schedule data changed.",
    });
  }
}
